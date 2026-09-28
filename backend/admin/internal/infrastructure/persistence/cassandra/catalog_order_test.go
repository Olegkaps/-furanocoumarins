package cassandra

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestCatalogNameCursorRetainsDuplicateTitleIdentity(t *testing.T) {
	page := catalogPage("chemicals", 1, "", "", "id", []map[string]any{
		{"id": "a", catalogSortField: "same"}, {"id": "b", catalogSortField: "same"},
	})
	decoded, err := decodeCatalogCursor(page.NextCursor)
	require.NoError(t, err)
	var values []string
	require.NoError(t, json.Unmarshal([]byte(decoded[1:]), &values))
	require.Equal(t, []string{"same", "a"}, values)
}

func TestCatalogNameSeekBindsTitleAndID(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	query := `SELECT row_to_json(source_row)::text,lower("name") COLLATE "C" FROM (SELECT * FROM catalog WHERE (lower("name") COLLATE "C","id") > ($1 COLLATE "C",$2) ORDER BY lower("name") COLLATE "C" ASC,"id" ASC LIMIT $3) source_row`
	mock.ExpectQuery(regexp.QuoteMeta(query)).WithArgs("o'brien", "a", 3).WillReturnRows(sqlmock.NewRows([]string{"row", "name"}))
	rows, err := catalogNameRows(context.Background(), db, "catalog", `"id"`, `lower("name") COLLATE "C"`, "\x00[\"o'brien\",\"a\"]", "", 2)
	require.NoError(t, err)
	require.NoError(t, rows.Close())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCatalogNameExpressionUsesFullSpeciesAndNameBeforeID(t *testing.T) {
	columns := []CatalogColumn{{Column: "id", Type: "primary"}, {Column: "species", Type: "clas[0]"}, {Column: "genus", Type: "clas[1]"}, {Column: "names", Type: "text"}}
	species, err := catalogNameExpression("species", "id", columns)
	require.NoError(t, err)
	require.Contains(t, species, `btrim("genus")`)
	require.Contains(t, species, ` || ' ' || `)
	require.Less(t, strings.Index(species, `"genus"`), strings.Index(species, `"species"`))
	chemical, err := catalogNameExpression("chemicals", "id", columns)
	require.NoError(t, err)
	require.Contains(t, chemical, `split_part("names",'=',1)`)
	require.Contains(t, chemical, `,"id")) COLLATE "C"`)
}

func TestCatalogChemicalNamesPreserveCustomColumnAndLabelSelection(t *testing.T) {
	for _, candidate := range []CatalogColumn{{Column: "chemical_names", Type: "text"}, {Column: "preferred", Name: "Trivial names", Type: "text"}} {
		columns := []CatalogColumn{{Column: "id", Type: "primary"}, {Column: "title", Type: "text"}, candidate}
		expression, err := catalogNameExpression("chemicals", "id", columns)
		require.NoError(t, err)
		require.Contains(t, expression, `split_part("`+candidate.Column+`",'=',1)`)
		require.NotContains(t, expression, `"title"`)
	}
}
