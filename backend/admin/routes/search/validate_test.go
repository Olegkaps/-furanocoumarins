package search_test

import (
	"admin/routes/search"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestValidateRequest(t *testing.T) {
	columns := []search.ColumnMeta{
		{
			Column:      "name",
			Type:        "primary",
			Description: "name of smth",
		},
		{
			Column:      "surname",
			Type:        "ref[]",
			Description: "surname of smth",
		},
		{
			Column:      "second_name",
			Type:        "set",
			Description: "second name of smth",
		},
	}

	tests := []struct {
		request       string
		columns       []search.ColumnMeta
		expectedError error
		description   string
	}{
		{
			request:       "",
			columns:       columns,
			expectedError: fmt.Errorf("search_request is required"),
			description:   "empty request",
		},
		{
			request:       "name = 'user'",
			columns:       columns,
			expectedError: nil,
			description:   "simple good request",
		},
		{
			request:       "name IN ('Alan', 'Alen') AND surname LIKE 'Gr%' AND second_name CONTAINS 'Igor'",
			columns:       columns,
			expectedError: nil,
			description:   "complex good request",
		},
		{
			request:       "name = 'user' AND role = 'admin'",
			columns:       columns,
			expectedError: fmt.Errorf("request have incorrect words (merged): role"),
			description:   "non-existent column",
		},
		{
			request:       "name = 'user'; DROP TABLE test",
			columns:       columns,
			expectedError: fmt.Errorf("request have incorrect words (merged): ;DROPTABLEtest"),
			description:   "cql injection column",
		},
		{
			request:       "name = 'user'; && touch /etc/f",
			columns:       columns,
			expectedError: fmt.Errorf("request have incorrect words (merged): ;&&touch/etc/f"),
			description:   "bash injection column",
		},
	}

	for _, test := range tests {
		err := search.Validate_request(test.request, test.columns)
		assert.Equalf(t, test.expectedError, err, test.description)
	}
}
