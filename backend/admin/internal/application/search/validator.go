package search

import (
	"fmt"
	"regexp"
	"strings"

	appcreate "admin/internal/application/create"
	domainsearch "admin/internal/domain/search"
	"admin/internal/presentation/http/response"
)

func ValidateRequest(searchRequest string, columns []domainsearch.ColumnMeta) error {
	if searchRequest == "" {
		return &response.UserError{E: fmt.Errorf("search request is required")}
	}

	// The public search grammar deliberately stays small.  PostgreSQL does not
	// need CQL's IN form for the UI workflows; accepting it here would create a
	// second, subtly different query language in the storage adapter.
	allowedWords := []string{"AND", "CONTAINS", "LIKE", "=", "!=", "<", ">", "<=", ">="}
	for i := range allowedWords {
		allowedWords[i] = `\s` + allowedWords[i] + `\s`
	}
	allowedPatterns := strings.Join(allowedWords, "|")
	regex := regexp.MustCompile(allowedPatterns)

	cleanedRequest := regex.ReplaceAllString(
		" "+strings.ReplaceAll(searchRequest, " ", "  ")+" ",
		"",
	)
	for _, col := range columns {
		cleanedRequest = strings.ReplaceAll(cleanedRequest, " "+col.Column+" ", "")
	}
	cleanedRequest = strings.TrimSpace(cleanedRequest)

	regex = regexp.MustCompile(`'[^']*'|\s`)
	cleanedRequest = regex.ReplaceAllString(cleanedRequest, "")

	if cleanedRequest != "" {
		return &response.UserError{E: fmt.Errorf("request contains incorrect words (merged): %v", ""+cleanedRequest)}
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
