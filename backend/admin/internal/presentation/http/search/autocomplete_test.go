package search

import (
	"admin/internal/app"
	"admin/internal/autocomplete"
	"admin/internal/chemistry"
	"admin/internal/infrastructure/persistence/cassandra"
	"context"
	"encoding/json"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAutocompleteRequestValidation(t *testing.T) {
	app := fiber.New()
	app.Get("/autocomplete/:column?", func(c *fiber.Ctx) error {
		_, _, _, err := autocompleteOptions(c)
		if err != nil {
			return c.SendStatus(400)
		}
		_, err = structureOptions(c)
		if err != nil {
			return c.SendStatus(400)
		}
		return c.SendStatus(200)
	})
	for _, tt := range []struct {
		path   string
		status int
	}{{"?value=Angel", 200}, {"?value=x&limit=50", 200}, {"?value=x&columns=species,chemical", 200}, {"?value=x&limit=0", 400}, {"?value=x&limit=51", 400}, {"?value=x&limit=bad", 400}, {"?value=x&columns=species,", 400}, {"?value=" + strings.Repeat("a", 1025), 400}, {"?value=", 400}, {"?value=x&bond_order=1", 400}, {"?value=x&hetero_atoms=false&stereochemistry=true", 200}} {
		resp, err := app.Test(httptest.NewRequest("GET", "/autocomplete"+tt.path, nil))
		require.NoError(t, err)
		require.Equal(t, tt.status, resp.StatusCode, tt.path)
		require.NoError(t, resp.Body.Close())
	}
}

func TestAutocompleteHTTPContracts(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	store := cassandra.NewPostgresStore(db)
	h := NewHandler(&app.Container{Cassandra: store})
	server := fiber.New()
	server.Get("/autocomplete", h.Autocomplete)
	server.Get("/autocomplete/:column", h.Autocomplete)
	version := func() {
		mock.ExpectQuery("SELECT table_data,table_meta").WillReturnRows(sqlmock.NewRows([]string{"data", "meta", "key"}).AddRow("chemdb.data", "chemdb.meta", "v1"))
	}
	version()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT "column",show_name,type`).WillReturnRows(sqlmock.NewRows([]string{"column", "show_name", "type"}).AddRow("species", "Species", "text specie search"))
	mock.ExpectQuery("SELECT article_id,bibtex_text").WillReturnRows(sqlmock.NewRows([]string{"id", "text"}))
	mock.ExpectQuery("SELECT DISTINCT member.value").WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow("Angelica archangelica"))
	mock.ExpectCommit()
	version()
	resp, err := server.Test(httptest.NewRequest("GET", "/autocomplete?value=angelca", nil))
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)
	var all struct {
		Suggestions []autocomplete.Suggestion `json:"suggestions"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&all))
	require.NoError(t, resp.Body.Close())
	require.Len(t, all.Suggestions, 1)
	require.Equal(t, "Species", all.Suggestions[0].ShowName)
	require.Equal(t, "species", all.Suggestions[0].Group)
	version()
	version()
	resp, err = server.Test(httptest.NewRequest("GET", "/autocomplete/species?value=ANGEL", nil))
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)
	var legacy AutocompleteResponse
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&legacy))
	require.NoError(t, resp.Body.Close())
	require.Equal(t, []string{"Angelica archangelica"}, legacy.Values)
	version()
	resp, err = server.Test(httptest.NewRequest("GET", "/autocomplete/unknown?value=ANGEL", nil))
	require.NoError(t, err)
	require.Equal(t, 400, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestAutocompleteSearchScopeIncludesReferenceColumns(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	store := cassandra.NewPostgresStore(db)
	h := NewHandler(&app.Container{Cassandra: store})
	server := fiber.New()
	server.Get("/autocomplete", h.Autocomplete)
	version := func() {
		mock.ExpectQuery("SELECT table_data,table_meta").WillReturnRows(sqlmock.NewRows([]string{"data", "meta", "key"}).AddRow("chemdb.data", "chemdb.meta", "v1"))
	}
	version()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT "column",show_name,type`).WillReturnRows(sqlmock.NewRows([]string{"column", "show_name", "type"}).AddRow("reference", "Publication", "ref[]"))
	mock.ExpectQuery("SELECT article_id,bibtex_text").WillReturnRows(sqlmock.NewRows([]string{"id", "text"}).AddRow("paper-1", "title={Phototoxic coumarins}"))
	mock.ExpectQuery("SELECT DISTINCT member.value").WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow("paper-1"))
	mock.ExpectCommit()
	version()
	resp, err := server.Test(httptest.NewRequest("GET", "/autocomplete?scope=search&value=phototoxic", nil))
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)
	var body struct {
		Suggestions []autocomplete.Suggestion `json:"suggestions"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.NoError(t, resp.Body.Close())
	require.Len(t, body.Suggestions, 1)
	require.Equal(t, "reference", body.Suggestions[0].Column)
	require.Equal(t, "publications", body.Suggestions[0].Group)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSearchStructureFailureStatus(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
	}{{chemistry.ErrInvalidSMILES, 400}, {chemistry.ErrBusy, 503}, {chemistry.ErrUnavailable, 503}, {context.DeadlineExceeded, 503}} {
		server := fiber.New()
		server.Get("/search", func(c *fiber.Ctx) error { return searchError(c, tc.err) })
		resp, err := server.Test(httptest.NewRequest("GET", "/search", nil))
		require.NoError(t, err)
		require.Equal(t, tc.status, resp.StatusCode)
		require.NoError(t, resp.Body.Close())
		if tc.status == 503 {
			require.Equal(t, "1", resp.Header.Get("Retry-After"))
		}
	}
}
