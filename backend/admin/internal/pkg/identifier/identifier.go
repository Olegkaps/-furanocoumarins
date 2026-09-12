package identifier

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
