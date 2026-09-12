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

func TestVirtualSheetDefaultChainsAreDeterministicAndRejectCycles(t *testing.T) {
	for range 30 {
		s := appcreate.NewVirtualSheet()
		s.ColumnNames = []string{"first", "second", "third"}
		s.ColumnTypes = []string{"default[second]", "default[third]", ""}
		s.Rows = map[string][]any{"row": {"", "", "value"}}
		require.NoError(t, s.Postprocess())
		require.Equal(t, []any{"value", "value", "value"}, s.Rows["row"])
	}
	s := appcreate.NewVirtualSheet()
	s.ColumnNames = []string{"first", "second"}
	s.ColumnTypes = []string{"default[second]", "default[first]"}
	s.Rows = map[string][]any{"row": {"", ""}}
	require.ErrorContains(t, s.Postprocess(), "cyclic default")
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

func TestVirtualSheetPostprocessUsesExactSetToken(t *testing.T) {
	sheet := appcreate.NewVirtualSheet()
	sheet.ColumnNames = []string{"id", "offset", "sunset_id"}
	sheet.ColumnTypes = []string{"primary", "offset", "external[sunset]"}
	sheet.KeyColumn = "id"
	sheet.Rows = map[string][]any{
		"1": {"1", "keep spaces", "sunset-1"},
	}

	require.NoError(t, sheet.Postprocess())
	assert.Equal(t, []string{"id TEXT", "offset TEXT", "sunset_id TEXT"}, sheet.ColumnCassTypes)
	assert.Equal(t, "keep spaces", sheet.Rows["1"][1], "offset must not be parsed as a set token")
	assert.Equal(t, "sunset-1", sheet.Rows["1"][2], "the external modifier argument must not be parsed as a set token")
	assert.Equal(t, []string{"", "", "sunset"}, sheet.ArrangeOfExternals)
}

func TestVirtualSheetPostprocessSupportsStructuredScientificModifiers(t *testing.T) {
	sheet := appcreate.NewVirtualSheet()
	sheet.ColumnNames = []string{"id", "family", "source_link", "aliases"}
	sheet.ColumnTypes = []string{
		"primary",
		"clas[01][gbif] table_specie",
		"link[/articles/%s] table_",
		"set[Bergapten Psoralen] search chemical",
	}
	sheet.KeyColumn = "id"
	sheet.Rows = map[string][]any{
		"1": {"1", "Rutaceae", "ref-real", "Bergapten Psoralen"},
	}

	require.NoError(t, sheet.Postprocess())
	assert.Equal(t, []string{"id TEXT", "family TEXT", "source_link TEXT", "aliases SET<TEXT>"}, sheet.ColumnCassTypes)
	aliases, ok := sheet.Rows["1"][3].(map[string]struct{})
	require.True(t, ok)
	assert.Equal(t, map[string]struct{}{"Bergapten": {}, "Psoralen": {}}, aliases)
}

func TestVirtualSheetPostprocessAllowsEncodedPlaceholderWithinLinkPath(t *testing.T) {
	sheet := appcreate.NewVirtualSheet()
	sheet.ColumnNames = []string{"id", "powoid_original"}
	sheet.ColumnTypes = []string{
		"primary",
		"default[id] link[https://powo.science.kew.org/taxon/urn:lsid:ipni.org:names:%s]",
	}
	sheet.KeyColumn = "id"
	sheet.Rows = map[string][]any{"123": {"123", "123"}}

	require.NoError(t, sheet.Postprocess())
	assert.Equal(t, []string{"id TEXT", "powoid_original TEXT"}, sheet.ColumnCassTypes)
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

func TestParseExternalSheetStrictForms(t *testing.T) {
	for _, test := range []struct {
		columnType string
		want       string
		present    bool
		wantErr    bool
	}{
		{"text", "", false, false},
		{"text external[classification] search", "classification", true, false},
		{"external[ species data ]", "species data", true, false},
		{"text external[external_sources]", "external_sources", true, false},
		{"text default[external_id]", "", false, false},
		{"external", "", false, true},
		{"external[", "", false, true},
		{"external[]", "", false, true},
		{"external[ ]", "", false, true},
		{"external[a", "", false, true},
		{"external[a][b]", "", false, true},
		{"external[a] external[b]", "", false, true},
		{"notexternal[a]", "", false, true},
	} {
		t.Run(test.columnType, func(t *testing.T) {
			got, present, err := appcreate.ParseExternalSheet(test.columnType)
			if test.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, test.want, got)
			assert.Equal(t, test.present, present)
		})
	}
}

func TestVirtualSheetPostprocessStrictDefaultModifierForms(t *testing.T) {
	for _, columnType := range []string{"default", "default[", "default[]", "default[id][x]", "default[id] default[id]", "notdefault[id]"} {
		t.Run(columnType, func(t *testing.T) {
			sheet := appcreate.NewVirtualSheet()
			sheet.ColumnNames = []string{"id"}
			sheet.ColumnTypes = []string{columnType}
			sheet.KeyColumn = "id"
			sheet.Rows = map[string][]any{"1": {"1"}}
			require.Error(t, sheet.Postprocess())
		})
	}
}

func TestVirtualSheetPostprocessStrictScientificModifierForms(t *testing.T) {
	for _, columnType := range []string{
		"clas", "clas[", "clas[]", "clas[01][]", "clas[01][tag][extra]", "clas[01] clas[02]",
		"link", "link[", "link[]", "link[url][extra]", "link[url] link[other]",
		"link[javascript:%s]", "link[data:text/html,%s]", "link[http://example.test/%s]", "link[//example.test/%s]",
		"link[%s]", "link[/%s]", "link[https://%s.example.test/path]", "link[https://user@example.test/%s]",
		"link[https://example.test/no-placeholder]", "link[https://example.test/%s/%s]", "link[https://example.test/bad path/%s]",
		"link[https://example.test/\n%s]", "link[https://example.test/%s\\evil]",
		"link[https://example.test/?id=%s]", "link[https://example.test/path#%s]",
		"link[/articles?id=%s]", "link[/articles#%s]",
		"set[", "set[]", "set[a][b]", "set[a] set", "set set[a]", "set[a] set[b]",
	} {
		t.Run(columnType, func(t *testing.T) {
			sheet := appcreate.NewVirtualSheet()
			sheet.ColumnNames = []string{"id"}
			sheet.ColumnTypes = []string{columnType}
			sheet.KeyColumn = "id"
			sheet.Rows = map[string][]any{"1": {"1"}}
			require.NotPanics(t, func() {
				require.Error(t, sheet.Postprocess())
			})
		})
	}
}

func TestVirtualSheetPostprocessMalformedValuesReturnErrorsWithoutPanic(t *testing.T) {
	for _, sheet := range []*appcreate.VirtualSheet{
		{ColumnNames: []string{"id"}, ColumnTypes: []string{"external["}, KeyColumn: "id", Rows: map[string][]any{"1": {"1"}}},
		{ColumnNames: []string{"id", "tags"}, ColumnTypes: []string{"primary", "set"}, KeyColumn: "id", Rows: map[string][]any{"1": {"1", 42}}},
		{ColumnNames: []string{"id", "name"}, ColumnTypes: []string{"primary", "text"}, KeyColumn: "id", Rows: map[string][]any{"1": {"1"}}},
		{ColumnNames: []string{"id"}, ColumnTypes: []string{"default["}, KeyColumn: "id", Rows: map[string][]any{"1": {"1"}}},
	} {
		require.NotPanics(t, func() {
			require.Error(t, sheet.Postprocess())
		})
	}
}
