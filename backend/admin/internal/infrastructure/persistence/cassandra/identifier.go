package cassandra

import (
	"fmt"
	"regexp"
	"strings"
)

var cqlIdentifierPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*$`)

var cqlReservedIdentifiers = map[string]struct{}{
	"add": {}, "allow": {}, "alter": {}, "and": {}, "apply": {}, "as": {}, "asc": {}, "authorize": {},
	"batch": {}, "begin": {}, "by": {}, "create": {}, "delete": {}, "desc": {}, "drop": {}, "from": {},
	"grant": {}, "in": {}, "index": {}, "insert": {}, "into": {}, "is": {}, "keyspace": {}, "limit": {},
	"modify": {}, "not": {}, "null": {}, "of": {}, "on": {}, "or": {}, "order": {}, "password": {},
	"primary": {}, "rename": {}, "revoke": {}, "schema": {}, "select": {}, "set": {}, "table": {}, "to": {},
	"token": {}, "truncate": {}, "unlogged": {}, "update": {}, "use": {}, "using": {}, "view": {}, "where": {}, "with": {},
}

// ValidateIdentifier accepts only unquoted CQL identifiers. Import metadata is
// never quoted because names are reused by search/query builders, so rejecting
// unsafe names is clearer and safer than attempting context-dependent escaping.
func ValidateIdentifier(value string) error {
	if !cqlIdentifierPattern.MatchString(value) {
		return fmt.Errorf("unsafe Cassandra identifier %q: use a letter followed by letters, digits, or underscores", value)
	}
	if _, reserved := cqlReservedIdentifiers[strings.ToLower(value)]; reserved {
		return fmt.Errorf("unsafe Cassandra identifier %q: reserved CQL keyword", value)
	}
	return nil
}

// ValidateTypeToken validates non-interpolated workbook type/modifier labels.
// CQL keywords are valid metadata tokens (for example "set" and "primary"),
// but punctuation and statement delimiters are not.
func ValidateTypeToken(value string) error {
	if !cqlIdentifierPattern.MatchString(value) {
		return fmt.Errorf("unsafe metadata type token %q", value)
	}
	return nil
}

func validateQualifiedIdentifier(value string) error {
	parts := strings.Split(value, ".")
	if len(parts) == 0 || len(parts) > 2 {
		return fmt.Errorf("unsafe Cassandra table identifier %q", value)
	}
	for _, part := range parts {
		if err := ValidateIdentifier(part); err != nil {
			return err
		}
	}
	return nil
}

func validateColumnDefinitions(columnDefs, primaryKeys []string) ([]string, error) {
	if len(columnDefs) == 0 {
		return nil, fmt.Errorf("at least one Cassandra column is required")
	}
	columns := make([]string, 0, len(columnDefs))
	seen := make(map[string]struct{}, len(columnDefs))
	for _, definition := range columnDefs {
		fields := strings.Fields(definition)
		if len(fields) != 2 ||
			(fields[1] != "TEXT" && fields[1] != "SET<TEXT>" && fields[1] != "UUID") {
			return nil, fmt.Errorf("unsafe Cassandra column definition %q", definition)
		}
		if err := ValidateIdentifier(fields[0]); err != nil {
			return nil, err
		}
		key := strings.ToLower(fields[0])
		if _, duplicate := seen[key]; duplicate {
			return nil, fmt.Errorf("duplicate Cassandra column identifier %q", fields[0])
		}
		seen[key] = struct{}{}
		columns = append(columns, fields[0])
	}
	if len(primaryKeys) == 0 {
		return nil, fmt.Errorf("at least one Cassandra primary key is required")
	}
	for _, key := range primaryKeys {
		if err := ValidateIdentifier(key); err != nil {
			return nil, err
		}
		if _, exists := seen[strings.ToLower(key)]; !exists {
			return nil, fmt.Errorf("Cassandra primary key %q is not a declared column", key)
		}
	}
	return columns, nil
}
