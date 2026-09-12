package cassandra

import (
	"admin/internal/pkg/identifier"
	"fmt"
	"strings"
)

func ValidateIdentifier(value string) error { return identifier.ValidateIdentifier(value) }
func ValidateTypeToken(value string) error  { return identifier.ValidateTypeToken(value) }

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
			return nil, fmt.Errorf("cassandra primary key %q is not a declared column", key)
		}
	}
	return columns, nil
}
