package search

import (
	"fmt"
	"regexp"
	"strings"
)

func Validate_request(searchRequest string, columns []ColumnMeta) error {
	// TODO: validate order
	allowedWords := []string{"AND", "OR", "LIKE", "CONTAINS", "(", ")", "=", "<", ">", "<=", ">="}
	for i := range allowedWords {
		allowedWords[i] = `\s` + allowedWords[i] + `\s`
	}
	allowedPatterns := strings.Join(allowedWords, "|")
	regex := regexp.MustCompile(allowedPatterns)

	// check white list
	cleanedRequest := regex.ReplaceAllString(searchRequest, "")
	for _, col := range columns {
		cleanedRequest = strings.ReplaceAll(cleanedRequest, col.Column, "")
	}
	cleanedRequest = strings.TrimSpace(cleanedRequest)

	regex = regexp.MustCompile(`\d+(?:\.\d+)?|'[^']*'|"[^"]*"`) // TO DO: disable "", allow sets
	cleanedRequest = regex.ReplaceAllString(cleanedRequest, "")

	// expect empty string
	if cleanedRequest != "" {
		return fmt.Errorf("request have incorrect words (merged): %s", ""+cleanedRequest)
	}
	return nil
}
