package bibtex_test

import (
	"admin/utils/bibtex"
	"testing"

	"github.com/stretchr/testify/assert"
	"golang.org/x/exp/slices"
)

func TestValidateRequest(t *testing.T) {
	tests := []struct {
		corrIds        map[string]string
		idsToCheck     []string
		expectedErrors []string
		description    string
	}{
		{
			corrIds:        map[string]string{},
			idsToCheck:     []string{},
			expectedErrors: []string{},
			description:    "empty ids",
		},
		{
			corrIds:        map[string]string{},
			idsToCheck:     []string{"a", "b"},
			expectedErrors: []string{"missing article id 'a'", "missing article id 'b'"},
			description:    "empty corr_ids",
		},
		{
			corrIds:        map[string]string{"a": "c", "b": "d", "e": "g"},
			idsToCheck:     []string{"a", "b"},
			expectedErrors: []string{},
			description:    "all is ok",
		},
		{
			corrIds:        map[string]string{"a": "c", "b": "d", "e": "g"},
			idsToCheck:     []string{"a", "b", "c"},
			expectedErrors: []string{"missing article id 'c'"},
			description:    "missing column",
		},
	}

	for _, test := range tests {
		errors := bibtex.Check_artickle_ids(test.corrIds, test.idsToCheck)
		slices.Sort(test.expectedErrors)
		slices.Sort(errors)
		assert.Equalf(t, test.expectedErrors, errors, test.description)
	}
}
