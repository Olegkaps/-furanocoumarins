package search

import (
	"fmt"
	"regexp"
	"strings"
)

func Validate_request(searchRequest string, columns []ColumnMeta) error {
	// TODO: validate order
	allowedWords := []string{"AND", "OR", "LIKE", "CONTAINS", "(", ")", "=", "<", ">", "<=", ">=", "<>"}
	allowedPatterns := strings.Join(allowedWords, "|")
	regex := regexp.MustCompile(`(?i)\b(` + allowedPatterns + `)\b`)

	// check white list
	cleanedRequest := regex.ReplaceAllString(searchRequest, "")
	for _, col := range columns {
		cleanedRequest = strings.ReplaceAll(cleanedRequest, col.Column, "")
	}
	cleanedRequest = strings.TrimSpace(cleanedRequest)

	regex = regexp.MustCompile(`\d+(?:\.\d+)?|'[^']*'|"[^"]*"`)
	cleanedRequest = regex.ReplaceAllString(cleanedRequest, "")

	// expect empty string
	if cleanedRequest != "" {
		return fmt.Errorf("request have incorrect words (merged): %s", ""+cleanedRequest)
	}
	return nil
}
