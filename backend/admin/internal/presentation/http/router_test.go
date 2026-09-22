package http_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/require"

	"admin/internal/app"
	infraauth "admin/internal/infrastructure/authmaster"
	"admin/internal/infrastructure/persistence/cassandra"
	presentation "admin/internal/presentation/http"
)

type routeAuth struct{ admin bool }

func (f *routeAuth) Request(context.Context, string, string, string, io.Reader, string) (*http.Response, error) {
	return nil, errors.New("unused")
}
func (f *routeAuth) RequestWithCredentials(context.Context, string, string, string, string, string, io.Reader, string) (*http.Response, error) {
	return nil, errors.New("unused")
}
func (f *routeAuth) Me(context.Context, string) (infraauth.User, error) {
	return infraauth.User{Login: "actor", Email: ptr("actor@example.test")}, nil
}
func (f *routeAuth) HasRole(context.Context, string, string) (bool, error) { return f.admin, nil }
func ptr(value string) *string                                             { return &value }

func TestNewAppPing(t *testing.T) {
	container, err := app.New(app.Options{EnvType: "TEST"})
	require.NoError(t, err)

	fiberApp := presentation.NewApp(container)
	req := httptest.NewRequest(fiber.MethodGet, "/ping", nil)
	resp, err := fiberApp.Test(req)
	require.NoError(t, err)
	require.Equal(t, fiber.StatusOK, resp.StatusCode)
}

func TestNewAppConfigIsPublic(t *testing.T) {
	container, err := app.New(app.Options{EnvType: "TEST"})
	require.NoError(t, err)

	resp, err := presentation.NewApp(container).Test(httptest.NewRequest(fiber.MethodGet, "/config", nil))
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, fiber.StatusOK, resp.StatusCode)
	var body map[string]string
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.NotEmpty(t, body["taxonomy_info"])
	require.NotEmpty(t, body["classification_autocomplete_label"])
	require.NotEmpty(t, body["classification_autocomplete_hint"])
}

func TestTaxonAvailabilityIsPublicAndDatasetScoped(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	dataset := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
	document := []byte(`{"sheets":[{"name":"classification","columns":[{"name":"species","classification":{"level":0}},{"name":"genus","classification":{"level":1}}]}]}`)
	mock.ExpectQuery(`SELECT t\.created_at,t\.table_species,t\.table_data,m\.document`).WillReturnRows(sqlmock.NewRows([]string{"created_at", "table_species", "table_data", "document"}).AddRow(dataset, "chemdb.species_fixture", "chemdb.data_fixture", document))
	mock.ExpectQuery(`SELECT "species","genus" FROM "chemdb"\."species_fixture"`).WillReturnRows(sqlmock.NewRows([]string{"species", "genus"}).AddRow("communis", "Heracleum"))
	mock.ExpectQuery(`SELECT source,snapshot_type,external_taxid,count,checked_at`).WithArgs(dataset, 0, "rank:0:name:communis").WillReturnRows(sqlmock.NewRows([]string{"source", "snapshot_type", "external_taxid", "count", "checked_at"}).AddRow("ncbi", "genome", "9606", 2, dataset))
	container, err := app.New(app.Options{EnvType: "TEST", CassandraStore: cassandra.NewPostgresStore(db)})
	require.NoError(t, err)
	resp, err := presentation.NewApp(container).Test(httptest.NewRequest(fiber.MethodGet, "/taxa/0/availability?name=communis", nil))
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, fiber.StatusOK, resp.StatusCode)
	var body struct {
		DatasetVersion time.Time `json:"dataset_version"`
		Snapshots      []struct {
			Source     string `json:"source"`
			Provenance string `json:"provenance"`
		} `json:"snapshots"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, dataset, body.DatasetVersion)
	require.Equal(t, []struct {
		Source     string `json:"source"`
		Provenance string `json:"provenance"`
	}{{Source: "ncbi", Provenance: "browser_observed"}}, body.Snapshots)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestTaxonExternalIDsResolveFullSpeciesNameWithoutAuthentication(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	document := []byte(`{"sheets":[{"name":"classification","columns":[{"name":"species","classification":{"level":0}},{"name":"genus","classification":{"level":1}}]}]}`)
	mock.ExpectQuery(`SELECT t\.created_at,t\.table_species,t\.table_data,m\.document`).WillReturnRows(sqlmock.NewRows([]string{"created_at", "table_species", "table_data", "document"}).AddRow(time.Now(), "chemdb.species_fixture", "chemdb.data_fixture", document))
	mock.ExpectQuery(`SELECT "species","genus" FROM "chemdb"\."species_fixture"`).WillReturnRows(sqlmock.NewRows([]string{"species", "genus"}).AddRow("communis", "Heracleum"))
	mock.ExpectQuery(`SELECT c\.version,r\.ids FROM chemdb\.taxon_id_mapping_current`).WithArgs(0, "Heracleum communis").WillReturnRows(sqlmock.NewRows([]string{"version", "ids"}).AddRow(4, []byte(`{"ncbi":"3747"}`)))
	container, err := app.New(app.Options{EnvType: "TEST", CassandraStore: cassandra.NewPostgresStore(db)})
	require.NoError(t, err)
	resp, err := presentation.NewApp(container).Test(httptest.NewRequest(fiber.MethodGet, "/taxa/0/external-ids?name=Heracleum%20communis", nil))
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, fiber.StatusOK, resp.StatusCode)
	var body struct {
		Version        int64             `json:"version"`
		ScientificName string            `json:"scientific_name"`
		IDs            map[string]string `json:"ids"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, int64(4), body.Version)
	require.Equal(t, "Heracleum communis", body.ScientificName)
	require.Equal(t, map[string]string{"ncbi": "3747"}, body.IDs)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestEveryDomainMutationDeniesAuthenticatedNonAdmin(t *testing.T) {
	container, err := app.New(app.Options{EnvType: "TEST", AuthMaster: &routeAuth{admin: false}})
	require.NoError(t, err)
	application := presentation.NewApp(container)
	for _, target := range []struct{ method, path string }{
		{fiber.MethodPost, "/create-table"}, {fiber.MethodPost, "/make-table-active/not-a-time"},
		{fiber.MethodGet, "/table-imports/not-an-import"},
		{fiber.MethodGet, "/metadata-versions"}, {fiber.MethodGet, "/metadata-versions/latest"}, {fiber.MethodPost, "/metadata-versions"},
		{fiber.MethodPost, "/metadata-versions/validate"},
		{fiber.MethodDelete, "/table/not-a-time"}, {fiber.MethodDelete, "/tables"},
		{fiber.MethodPut, "/bibtex"}, {fiber.MethodPut, "/pages/about"}, {fiber.MethodPut, "/admin/about/pages"},
		{fiber.MethodPut, "/taxa/0/availability"},
		{fiber.MethodGet, "/admin/taxon-id-mapping"}, {fiber.MethodPost, "/admin/taxon-id-mapping"},
		{fiber.MethodGet, "/admin/images"}, {fiber.MethodPost, "/admin/images"}, {fiber.MethodPut, "/admin/images/not-an-id"}, {fiber.MethodDelete, "/admin/images/not-an-id"},
	} {
		req := httptest.NewRequest(target.method, target.path, nil)
		req.Header.Set("Authorization", "Bearer non-admin")
		resp, requestErr := application.Test(req)
		require.NoError(t, requestErr, target.path)
		require.Equal(t, fiber.StatusForbidden, resp.StatusCode, target.path)
	}
}

func TestMetadataAdministrationRejectsAnonymousRequests(t *testing.T) {
	container, err := app.New(app.Options{EnvType: "TEST", AuthMaster: &routeAuth{admin: true}})
	require.NoError(t, err)
	application := presentation.NewApp(container)
	for _, target := range []struct{ method, path string }{{fiber.MethodGet, "/metadata-versions"}, {fiber.MethodGet, "/metadata-versions/latest"}, {fiber.MethodPost, "/metadata-versions"}, {fiber.MethodPost, "/metadata-versions/validate"}} {
		resp, err := application.Test(httptest.NewRequest(target.method, target.path, nil))
		require.NoError(t, err)
		require.Equal(t, fiber.StatusUnauthorized, resp.StatusCode)
		require.NoError(t, resp.Body.Close())
	}
}

func TestMetadataDraftValidationUsesImportContractWithoutDatabase(t *testing.T) {
	container, err := app.New(app.Options{EnvType: "TEST", AuthMaster: &routeAuth{admin: true}})
	require.NoError(t, err)
	application := presentation.NewApp(container)
	draft := `{"document":{"schema_version":2,"importable":true,"sheets":[{"name":"main","source_sheets":["Observations"],"columns":[{"name":"speciesid","data_type":"text","example":null}]},{"name":"classification","source_sheets":["Species"],"columns":[{"name":"speciesid","data_type":"text","primary_key":true}]}]}}`
	for _, tc := range []struct {
		name, body string
		status     int
	}{
		{"valid", draft, 200},
		{"old authoring schema", strings.Replace(draft, `"schema_version":2`, `"schema_version":1`, 1), 400},
		{"unknown field", strings.Replace(draft, `"example":null`, `"examples":null`, 1), 400},
		{"invalid type", strings.Replace(draft, `"data_type":"text"`, `"data_type":"integer"`, 1), 400},
		{"two documents", draft + draft, 400},
		{"missing document", `{}`, 400},
		{"oversized", strings.Repeat(" ", (1<<20)+1), 413},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(fiber.MethodPost, "/metadata-versions/validate", strings.NewReader(tc.body))
			req.Header.Set("Authorization", "Bearer admin")
			req.Header.Set("Content-Type", "application/json")
			resp, err := application.Test(req)
			require.NoError(t, err)
			defer resp.Body.Close()
			require.Equal(t, tc.status, resp.StatusCode)
			if tc.status == 200 {
				var body struct {
					Valid    bool `json:"valid"`
					Resolved struct {
						Sheets []struct {
							Columns []struct {
								External string `json:"external_sheet"`
							} `json:"columns"`
						} `json:"sheets"`
					} `json:"resolved_document"`
				}
				require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
				require.True(t, body.Valid)
				require.Equal(t, "classification", body.Resolved.Sheets[0].Columns[0].External)
			}
		})
	}
}

func TestNewMetadataPublicationRejectsOldSchemaBeforePersistence(t *testing.T) {
	container, err := app.New(app.Options{EnvType: "TEST", AuthMaster: &routeAuth{admin: true}})
	require.NoError(t, err)
	application := presentation.NewApp(container)
	body := `{"base_version":0,"document":{"schema_version":1,"importable":true,"sheets":[{"name":"main","source_sheets":["Observations"],"columns":[{"name":"value","data_type":"text"}]},{"name":"classification","source_sheets":["Species"],"columns":[{"name":"speciesid","data_type":"text","primary_key":true}]}]}}`
	req := httptest.NewRequest(fiber.MethodPost, "/metadata-versions", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer admin")
	req.Header.Set("Content-Type", "application/json")
	resp, err := application.Test(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, 400, resp.StatusCode)
	payload, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.Contains(t, string(payload), "schema_version 2")
}
