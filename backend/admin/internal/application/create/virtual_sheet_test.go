package create_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"

	appcreate "admin/internal/application/create"
)

func TestNewVirtualSheetPositive(t *testing.T) {
	sheet := appcreate.NewVirtualSheet()
	require.NotNil(t, sheet)
	assert.Empty(t, sheet.RealSheetNames)
	assert.NotNil(t, sheet.Rows)
}

func TestVirtualSheetPostprocessPositive(t *testing.T) {
	sheet := appcreate.NewVirtualSheet()
	sheet.ColumnNames = []string{"name", "tags"}
	sheet.ColumnTypes = []string{"text", "set"}
	sheet.KeyColumn = "name"
	sheet.Rows = map[string][]any{
		"k1": {"alice", "a b"},
	}

	err := sheet.Postprocess()
	require.NoError(t, err)

	assert.Equal(t, []string{"name TEXT", "tags SET<TEXT>"}, sheet.ColumnCassTypes)
	tags, ok := sheet.Rows["k1"][1].(map[string]struct{})
	require.True(t, ok)
	assert.Contains(t, tags, "a")
	assert.Contains(t, tags, "b")
}

func TestVirtualSheetPostprocessNegativeMissingExternal(t *testing.T) {
	sheet := appcreate.NewVirtualSheet()
	sheet.ColumnNames = []string{"name", "ref"}
	sheet.ColumnTypes = []string{"primary", "external[other]"}
	sheet.KeyColumn = "name"
	sheet.Rows = map[string][]any{
		"k1": {"alice", ""},
	}

	err := sheet.Postprocess()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing external key")
}

func TestVirtualSheetPostprocessNegativeBadDefaultColumn(t *testing.T) {
	sheet := appcreate.NewVirtualSheet()
	sheet.ColumnNames = []string{"name", "alias"}
	sheet.ColumnTypes = []string{"text", "default[missing]"}
	sheet.KeyColumn = "name"
	sheet.Rows = map[string][]any{
		"k1": {"alice", ""},
	}

	err := sheet.Postprocess()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "cannot find default column")
}

func TestVirtualSheetReadFilePositive(t *testing.T) {
	f := excelize.NewFile()
	require.NoError(t, f.SetSheetRow("Sheet1", "A1", &[]any{"id", "val"}))
	require.NoError(t, f.SetSheetRow("Sheet1", "A2", &[]any{"1", "x"}))

	sheet := appcreate.NewVirtualSheet()
	sheet.RealSheetNames = []string{"Sheet1"}
	sheet.ColumnNames = []string{"id", "val"}
	sheet.KeyColumn = "id"

	err := sheet.ReadFile(f)
	require.NoError(t, err)
	assert.Equal(t, []any{"1", "x"}, sheet.Rows["1"])
}

func TestVirtualSheetPostprocessIdempotentPositive(t *testing.T) {
	sheet := appcreate.NewVirtualSheet()
	sheet.ColumnNames = []string{"name"}
	sheet.ColumnTypes = []string{"text"}
	sheet.KeyColumn = "name"
	sheet.Rows = map[string][]any{"k1": {"alice"}}

	require.NoError(t, sheet.Postprocess())
	require.NoError(t, sheet.Postprocess())
}

func TestVirtualSheetPostprocessDefaultColumnPositive(t *testing.T) {
	sheet := appcreate.NewVirtualSheet()
	sheet.ColumnNames = []string{"name", "alias"}
	sheet.ColumnTypes = []string{"text", "default[name]"}
	sheet.KeyColumn = "name"
	sheet.Rows = map[string][]any{
		"k1": {"alice", ""},
	}

	err := sheet.Postprocess()
	require.NoError(t, err)
	assert.Equal(t, "alice", sheet.Rows["k1"][1])
}

func TestVirtualSheetPostprocessEmptyTextBecomesSpace(t *testing.T) {
	sheet := appcreate.NewVirtualSheet()
	sheet.ColumnNames = []string{"name", "note"}
	sheet.ColumnTypes = []string{"text", "text"}
	sheet.KeyColumn = "name"
	sheet.Rows = map[string][]any{
		"k1": {"alice", ""},
	}

	err := sheet.Postprocess()
	require.NoError(t, err)
	assert.Equal(t, " ", sheet.Rows["k1"][1])
}

func TestVirtualSheetPostprocessExternalArrangePositive(t *testing.T) {
	sheet := appcreate.NewVirtualSheet()
	sheet.ColumnNames = []string{"id", "ref"}
	sheet.ColumnTypes = []string{"primary", "external[classification]"}
	sheet.KeyColumn = "id"
	sheet.Rows = map[string][]any{
		"1": {"1", "c1"},
	}

	err := sheet.Postprocess()
	require.NoError(t, err)
	assert.Equal(t, []string{"", "classification"}, sheet.ArrangeOfExternals)
}
