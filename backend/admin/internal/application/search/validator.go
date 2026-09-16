package search

import (
	"fmt"

	appcreate "admin/internal/application/create"
	domainsearch "admin/internal/domain/search"
	"admin/internal/pkg/searchquery"
	"admin/internal/presentation/http/response"
)

func ValidateRequest(searchRequest string, columns []domainsearch.ColumnMeta) error {
	if searchRequest == "" {
		return &response.UserError{E: fmt.Errorf("search request is required")}
	}

	expr, err := searchquery.Parse(searchRequest)
	if err != nil {
		return &response.UserError{E: err}
	}
	allowed := make(map[string]bool, len(columns))
	smiles := make(map[string]bool, len(columns))
	for _, col := range columns {
		allowed[col.Column] = true
		smiles[col.Column], _ = appcreate.HasColumnTypeToken(col.Type, "smiles")
	}
	if err := expr.ValidateColumns(allowed); err != nil {
		return &response.UserError{E: err}
	}
	if err := expr.ValidateStructures(smiles); err != nil {
		return &response.UserError{E: err}
	}
	return nil
}

func VisibleColumns(columns []domainsearch.ColumnMeta) []string {
	var selected []string
	for _, col := range columns {
		hidden, err := appcreate.HasColumnTypeToken(col.Type, "invisible")
		if err == nil && !hidden {
			selected = append(selected, col.Column)
		}
	}
	return selected
}

func IsTypesEqual(oldType, newType string) bool {
	equal, err := appcreate.ColumnTypesEquivalent(oldType, newType)
	return err == nil && equal
}
