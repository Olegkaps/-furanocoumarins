package excel_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"

	"admin/internal/application/create/excel"
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

func TestFindColumnIndexPositive(t *testing.T) {
	assert.Equal(t, 0, excel.FindColumnIndex([]string{"a", "b"}, "a"))
}

func TestRemoveHidenPositiveNoMarkers(t *testing.T) {
	assert.Equal(t, "plain", excel.RemoveHiden("plain"))
}

func TestReadXLSXToMapPositive(t *testing.T) {
	f := excelize.NewFile()
	sheet := "Sheet1"
	require.NoError(t, f.SetSheetRow(sheet, "A1", &[]any{"id", "name"}))
	require.NoError(t, f.SetSheetRow(sheet, "A2", &[]any{"1", "alice"}))

	result, err := excel.ReadXLSXToMap(f, sheet, []string{"id", "name"}, "id")
	require.NoError(t, err)
	assert.Equal(t, []string{"1", "alice"}, result["1"])
}

func TestReadXLSXToMapNegativeMissingColumn(t *testing.T) {
	f := excelize.NewFile()
	sheet := "Sheet1"
	require.NoError(t, f.SetSheetRow(sheet, "A1", &[]any{"id"}))

	_, err := excel.ReadXLSXToMap(f, sheet, []string{"missing"}, "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestReadXLSXToMapNegativeDuplicateKey(t *testing.T) {
	f := excelize.NewFile()
	sheet := "Sheet1"
	require.NoError(t, f.SetSheetRow(sheet, "A1", &[]any{"id", "name"}))
	require.NoError(t, f.SetSheetRow(sheet, "A2", &[]any{"1", "a"}))
	require.NoError(t, f.SetSheetRow(sheet, "A3", &[]any{"1", "b"}))

	_, err := excel.ReadXLSXToMap(f, sheet, []string{"id", "name"}, "id")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not unique key")
}

func TestReadXLSXToMapMergedPositive(t *testing.T) {
	f := excelize.NewFile()
	require.NoError(t, f.SetSheetRow("Sheet1", "A1", &[]any{"id", "val"}))
	require.NoError(t, f.SetSheetRow("Sheet1", "A2", &[]any{"1", "x"}))
	_, err := f.NewSheet("Sheet2")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("Sheet2", "A1", &[]any{"id", "val"}))
	require.NoError(t, f.SetSheetRow("Sheet2", "A2", &[]any{"2", "y"}))

	result, err := excel.ReadXLSXToMapMerged(f, []string{"Sheet1", "Sheet2"}, []string{"id", "val"}, "id")
	require.NoError(t, err)
	assert.Len(t, result, 2)
}

func TestReadXLSXToMapMergedNegativeDuplicateAcrossSheets(t *testing.T) {
	f := excelize.NewFile()
	require.NoError(t, f.SetSheetRow("Sheet1", "A1", &[]any{"id"}))
	require.NoError(t, f.SetSheetRow("Sheet1", "A2", &[]any{"1"}))
	_, err := f.NewSheet("Sheet2")
	require.NoError(t, err)
	require.NoError(t, f.SetSheetRow("Sheet2", "A1", &[]any{"id"}))
	require.NoError(t, f.SetSheetRow("Sheet2", "A2", &[]any{"1"}))

	_, err = excel.ReadXLSXToMapMerged(f, []string{"Sheet1", "Sheet2"}, []string{"id"}, "id")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not unique key")
}

func TestReadXLSXToMapEmptySheetPositive(t *testing.T) {
	f := excelize.NewFile()
	result, err := excel.ReadXLSXToMap(f, "Sheet1", []string{"id"}, "id")
	require.NoError(t, err)
	assert.Empty(t, result)
}

func TestReadXLSXToMapNoKeyColumnPositive(t *testing.T) {
	f := excelize.NewFile()
	require.NoError(t, f.SetSheetRow("Sheet1", "A1", &[]any{"a", "b"}))
	require.NoError(t, f.SetSheetRow("Sheet1", "A2", &[]any{"1", "2"}))

	result, err := excel.ReadXLSXToMap(f, "Sheet1", []string{"a", "b"}, "")
	require.NoError(t, err)
	assert.Contains(t, result, "1\t2")
}

func TestReadXLSXToMapNegativeMissingPrimaryColumn(t *testing.T) {
	f := excelize.NewFile()
	require.NoError(t, f.SetSheetRow("Sheet1", "A1", &[]any{"name"}))

	_, err := excel.ReadXLSXToMap(f, "Sheet1", []string{"name"}, "id")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "primary column")
}

func TestReadXLSXToMapNegativeEmptyKey(t *testing.T) {
	f := excelize.NewFile()
	require.NoError(t, f.SetSheetRow("Sheet1", "A1", &[]any{"id", "name"}))
	require.NoError(t, f.SetSheetRow("Sheet1", "A2", &[]any{"", "orphan"}))

	_, err := excel.ReadXLSXToMap(f, "Sheet1", []string{"id", "name"}, "id")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty key")
}

func TestReadXLSXToMapNegativeMissingKeyInRow(t *testing.T) {
	f := excelize.NewFile()
	require.NoError(t, f.SetSheetRow("Sheet1", "A1", &[]any{"name", "id"}))
	require.NoError(t, f.SetSheetRow("Sheet1", "A2", &[]any{"orphan"}))

	_, err := excel.ReadXLSXToMap(f, "Sheet1", []string{"name", "id"}, "id")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing key")
}

func TestReadXLSXToMapSkipsBlankRowsPositive(t *testing.T) {
	f := excelize.NewFile()
	require.NoError(t, f.SetSheetRow("Sheet1", "A1", &[]any{"id"}))
	require.NoError(t, f.SetSheetRow("Sheet1", "A2", &[]any{""}))
	require.NoError(t, f.SetSheetRow("Sheet1", "A3", &[]any{"1"}))

	result, err := excel.ReadXLSXToMap(f, "Sheet1", []string{"id"}, "id")
	require.NoError(t, err)
	assert.Equal(t, []string{"1"}, result["1"])
}

func TestReadXLSXToMapAppliesHiddenTextPositive(t *testing.T) {
	f := excelize.NewFile()
	require.NoError(t, f.SetSheetRow("Sheet1", "A1", &[]any{"id", "name"}))
	require.NoError(t, f.SetSheetRow("Sheet1", "A2", &[]any{"1", "vis#hidden#"}))

	result, err := excel.ReadXLSXToMap(f, "Sheet1", []string{"id", "name"}, "id")
	require.NoError(t, err)
	assert.Equal(t, []string{"1", "vis"}, result["1"])
}
