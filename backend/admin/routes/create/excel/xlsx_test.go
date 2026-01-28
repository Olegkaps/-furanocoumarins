package excel_test

import (
	"admin/routes/create/excel"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRemoveHidenText(t *testing.T) {
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

func TestFindColunmIndex(t *testing.T) {
	tests := []struct {
		header      []string
		colName     string
		expectedInd int
		description string
	}{
		{
			header:      []string{},
			colName:     "",
			expectedInd: -1,
			description: "empty header",
		},
		{
			header:      []string{"test 1", "test 2", "test 3"},
			colName:     "test 4",
			expectedInd: -1,
			description: "no col in header",
		},
		{
			header:      []string{"test 1", "test 2", "test 3", "test 2"},
			colName:     "test 2",
			expectedInd: 1,
			description: "duplicate in header",
		},
	}

	for _, test := range tests {
		resInd := excel.FindColumnIndex(test.header, test.colName)
		assert.Equalf(t, test.expectedInd, resInd, test.description)
	}
}
