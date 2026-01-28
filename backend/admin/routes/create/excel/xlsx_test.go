package excel_test

import (
	"admin/routes/create/excel"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestExistingRoutesAccess(t *testing.T) {
	tests := []struct {
		str         string
		expectedStr string
		description string
	}{
		{
			str:         "no need remove",
			expectedStr: "no need remove",
			description: "without #",
		},
		{
			str:         "i love# Harry Potter#",
			expectedStr: "i love",
			description: "one #..#",
		},
		{
			str:         "i# #love# Harry# Potter##",
			expectedStr: "ilove Potter",
			description: "several #..#",
		},
	}

	for _, test := range tests {
		resStr := excel.RemoveHiden(test.str)
		assert.Equalf(t, test.expectedStr, resStr, test.description)
	}
}
