package metadata

import (
	"encoding/json"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
)

func validDocument() Document {
	return Document{SchemaVersion: 1, Importable: true, Sheets: []Sheet{
		{Name: "main", SourceSheets: []string{"Observations"}, Columns: []Column{{Name: "speciesid", DataType: "text", ExternalSheet: "classification"}}},
		{Name: "classification", SourceSheets: []string{"Species"}, Columns: []Column{{Name: "speciesid", DataType: "text", PrimaryKey: true}, {Name: "tags", DataType: "set", Search: true}}},
	}}
}
func TestDocumentRejectsInvalidContracts(t *testing.T) {
	for name, mutate := range map[string]func(*Document){
		"unknown type":     func(d *Document) { d.Sheets[0].Columns[0].DataType = "number" },
		"mixed sheet case": func(d *Document) { d.Sheets[0].Name = "Main" },
		"missing source":   func(d *Document) { d.Sheets[0].SourceSheets = nil },
		"set primary":      func(d *Document) { d.Sheets[1].Columns[0].DataType = "set" },
		"external cycle": func(d *Document) {
			d.Sheets[0].Columns[0].PrimaryKey = true
			d.Sheets[1].Columns[0].ExternalSheet = "main"
		},
		"duplicate case": func(d *Document) {
			d.Sheets[1].Columns = append(d.Sheets[1].Columns, Column{Name: "TAGS", DataType: "text"})
		},
		"join mismatch":                 func(d *Document) { d.Sheets[0].Columns[0].Search = true },
		"contradictory inferred domain": func(d *Document) { d.Sheets[1].Columns[0].Domain = "chemical" },
		"default cycle": func(d *Document) {
			d.Sheets[1].Columns[0].DefaultColumn = "tags"
			d.Sheets[1].Columns[1].DefaultColumn = "speciesid"
		},
		"unsafe link":    func(d *Document) { d.Sheets[1].Columns[1].LinkTemplate = "https://%s.example.com/path" },
		"override flags": func(d *Document) { d.Sheets[1].Columns[1].LegacyFlags = []string{"primary"} },
	} {
		t.Run(name, func(t *testing.T) { d := validDocument(); mutate(&d); require.Error(t, d.Validate()) })
	}
}
func TestDocumentRoundTripLegacyModifiers(t *testing.T) {
	for _, legacy := range []string{"", "search table_2 chemical", "primary invisible", "set[alpha beta] search", "set[<>]", "ref[] link[/reference/%s]", "clas[3][powo] table_specie", "external[classification] default[speciesid]", "text keycolumn"} {
		c, err := ColumnFromLegacy([]string{"main", "value", legacy, "description", "Label"})
		require.NoError(t, err)
		again, err := ColumnFromLegacy([]string{"main", "value", c.LegacyType(), "description", "Label"})
		require.NoError(t, err)
		require.Equal(t, c, again)
	}
	d := validDocument()
	rows, err := d.Rows()
	require.NoError(t, err)
	require.Len(t, rows, 5)
	raw, err := json.Marshal(d)
	require.NoError(t, err)
	_, err = Decode(raw)
	require.NoError(t, err)
	_, err = Decode([]byte(strings.Replace(string(raw), `"schema_version":1`, `"schema_version":1,"typo":true`, 1)))
	require.ErrorContains(t, err, "unknown field")
	_, err = Decode(append(raw, []byte(` {}`)...))
	require.Error(t, err)
	_, err = Decode(make([]byte, MaxDocumentBytes+1))
	require.ErrorContains(t, err, "1 MiB")
}

func TestSharedKeysResolveWithoutChangingSavedDefinition(t *testing.T) {
	d := validDocument()
	d.SchemaVersion = 2
	d.Sheets[0].Columns[0].ExternalSheet = ""
	example := "Example species"
	d.Sheets[1].Columns[0].Example = &example
	require.NoError(t, d.Validate())
	resolved, err := d.ResolveJoins()
	require.NoError(t, err)
	require.Equal(t, "classification", resolved.Sheets[0].Columns[0].ExternalSheet)
	require.Empty(t, d.Sheets[0].Columns[0].ExternalSheet)
	rows, err := d.Rows()
	require.NoError(t, err)
	require.Contains(t, rows["2"][2], "external[classification]")
	require.NotContains(t, rows["4"][2], example)
	raw, err := json.Marshal(d)
	require.NoError(t, err)
	decoded, err := Decode(raw)
	require.NoError(t, err)
	require.Equal(t, &example, decoded.Sheets[1].Columns[0].Example)
	d.SchemaVersion = 1
	resolved, err = d.ResolveJoins()
	require.NoError(t, err)
	require.Empty(t, resolved.Sheets[0].Columns[0].ExternalSheet, "pinned v1 imports must not acquire new joins")
}

func TestSharedKeysRejectAmbiguityAndAllowExplicitSelection(t *testing.T) {
	d := validDocument()
	d.SchemaVersion = 2
	d.Sheets[0].Columns[0].ExternalSheet = ""
	d.Sheets = append(d.Sheets, Sheet{Name: "alternative", SourceSheets: []string{"Alternative"}, Columns: []Column{{Name: "speciesid", DataType: "text", PrimaryKey: true}}})
	require.ErrorContains(t, d.Validate(), "ambiguous common column")
	d.Sheets[0].Columns[0].ExternalSheet = "classification"
	require.NoError(t, d.Validate())
	resolved, err := d.ResolveJoins()
	require.NoError(t, err)
	require.Empty(t, resolved.Sheets[2].Columns[0].ExternalSheet)
}

func TestV2EntitySemanticsAndRootRules(t *testing.T) {
	for name, mutate := range map[string]func(*Document){
		"duplicate primary": func(d *Document) {
			d.Sheets[1].Columns = append(d.Sheets[1].Columns, Column{Name: "another", DataType: "text", PrimaryKey: true})
		},
		"classification chemical": func(d *Document) {
			d.Sheets[0].Columns = append(d.Sheets[0].Columns, Column{Name: "bad", DataType: "text", Domain: "chemical", Classification: &Classification{Level: 1}})
		},
		"species smiles": func(d *Document) { d.Sheets[1].Columns[1].Smiles = true },
		"join main": func(d *Document) {
			d.Sheets[0].Columns[0].PrimaryKey = true
			d.Sheets[1].Columns[0].ExternalSheet = "main"
		},
	} {
		t.Run(name, func(t *testing.T) {
			d := validDocument()
			d.SchemaVersion = 2
			mutate(&d)
			require.Error(t, d.Validate())
		})
	}
	d := validDocument()
	d.SchemaVersion = 2
	d.Sheets[0].Columns = append(d.Sheets[0].Columns, Column{Name: "publicationid", DataType: "text"})
	d.Sheets = append(d.Sheets, Sheet{Name: "publications", SourceSheets: []string{"Publications"}, Columns: []Column{{Name: "publicationid", DataType: "text", PrimaryKey: true}, {Name: "title", DataType: "text", Domain: "publication"}}})
	require.NoError(t, d.Validate())
	rows, err := d.Rows()
	require.NoError(t, err)
	for _, row := range rows {
		if row[1] == "publicationid" {
			require.Contains(t, row[2], "publication")
		}
	}
}

func TestExamplesAllowNullButRejectNonStrings(t *testing.T) {
	d := validDocument()
	raw, err := json.Marshal(d)
	require.NoError(t, err)
	for _, value := range []string{`null`, `""`, `"some text"`} {
		_, err = Decode([]byte(strings.Replace(string(raw), `"name":"speciesid"`, `"name":"speciesid","example":`+value, 1)))
		require.NoError(t, err)
	}
	for _, value := range []string{`123`, `[]`, `{}`, `true`} {
		_, err = Decode([]byte(strings.Replace(string(raw), `"name":"speciesid"`, `"name":"speciesid","example":`+value, 1)))
		require.Error(t, err)
	}
}

func TestNewDraftRequiresCurrentSchemaButHistoricalImportsRemainValid(t *testing.T) {
	d := validDocument()
	raw, err := json.Marshal(d)
	require.NoError(t, err)
	_, err = DecodeDraft(raw)
	require.ErrorContains(t, err, "schema_version 2")
	_, err = Decode(raw)
	require.NoError(t, err)
	d.SchemaVersion = 2
	raw, err = json.Marshal(d)
	require.NoError(t, err)
	_, err = DecodeDraft(raw)
	require.NoError(t, err)
}
