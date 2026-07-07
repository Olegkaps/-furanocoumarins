package search

import (
	"fmt"
	"regexp"
	"strings"

	domainsearch "admin/internal/domain/search"
	"admin/internal/presentation/http/response"
)

func ValidateRequest(searchRequest string, columns []domainsearch.ColumnMeta) error {
	if searchRequest == "" {
		return &response.UserError{E: fmt.Errorf("search request is required")}
	}

	allowedWords := []string{"AND", "IN", "CONTAINS", "LIKE", "=", "!=", "<", ">", "<=", ">="}
	for i := range allowedWords {
		allowedWords[i] = `\s` + allowedWords[i] + `\s`
	}
	allowedWords = append(allowedWords, `\(`, `\)`, `,`)
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
		if !strings.Contains(strings.ToLower(col.Type), "invisible") {
			selected = append(selected, col.Column)
		}
	}
	return selected
}

func IsTypesEqual(oldType, newType string) bool {
	oldList := strings.Split(oldType, " ")
	newList := strings.Split(newType, " ")

	oldMap := make(map[string]struct{})
	for _, t := range oldList {
		if t == "primary" || strings.Contains(t, "external[") {
			continue
		}
		oldMap[t] = struct{}{}
	}

	visited := 0
	for _, t := range newList {
		if t == "primary" || strings.Contains(t, "external[") {
			continue
		}
		visited++
		if _, exists := oldMap[t]; !exists {
			return false
		}
	}

	return len(oldMap) == visited
}
