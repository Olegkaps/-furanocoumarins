package search

import (
	"fmt"
	"regexp"
	"strings"
)

func Validate_request(searchRequest string, columns []ColumnMeta) error {
	// TO DO: validate order
	// TO DO: mayby add 'OR' and 'LIKE'
	allowedWords := []string{"AND", "IN", "CONTAINS", "=", "!=", "<", ">", "<=", ">="}
	for i := range allowedWords {
		allowedWords[i] = `\s` + allowedWords[i] + `\s`
	}
	allowedWords = append(allowedWords, `\(`, `\)`, `,`)
	allowedPatterns := strings.Join(allowedWords, "|")
	regex := regexp.MustCompile(allowedPatterns)

	// check white list
	cleanedRequest := regex.ReplaceAllString(searchRequest, "")
	for _, col := range columns {
		cleanedRequest = strings.ReplaceAll(cleanedRequest, col.Column, "")
	}
	cleanedRequest = strings.TrimSpace(cleanedRequest)

	// only 'strings'
	regex = regexp.MustCompile(`'[^']*'|\s`)
	cleanedRequest = regex.ReplaceAllString(cleanedRequest, "")

	// expect empty string
	if cleanedRequest != "" {
		return fmt.Errorf("request have incorrect words (merged): %v", ""+cleanedRequest)
	}
	return nil
}
