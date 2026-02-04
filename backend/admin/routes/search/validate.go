package search

import (
	"admin/utils/dbs/cassandra"
	"fmt"
	"regexp"
	"strings"
)

func Validate_request(searchRequest string, columns []*cassandra.ColumnMeta) error {
	if searchRequest == "" {
		return fmt.Errorf("search_request is required")
	}

	// TO DO: validate order
	// TO DO: mayby add 'OR' and 'LIKE'
	// TO DO: fix 'IN not supported for non-primary columns' error
	allowedWords := []string{"AND", "IN", "CONTAINS", "LIKE", "=", "!=", "<", ">", "<=", ">="}
	for i := range allowedWords {
		allowedWords[i] = `\s` + allowedWords[i] + `\s`
	}
	allowedWords = append(allowedWords, `\(`, `\)`, `,`)
	allowedPatterns := strings.Join(allowedWords, "|")
	regex := regexp.MustCompile(allowedPatterns)

	// check white list
	cleanedRequest := regex.ReplaceAllString(
		" "+strings.ReplaceAll(searchRequest, " ", "  ")+" ",
		"",
	)
	for _, col := range columns {
		cleanedRequest = strings.ReplaceAll(cleanedRequest, " "+col.Column+" ", "")
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
