//go:build integration

package create

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http/httptest"
	"os"
	"testing"

	"admin/internal/app"
	infraauth "admin/internal/infrastructure/authmaster"
	"admin/internal/infrastructure/persistence/cassandra"
	"admin/internal/pkg/metadata"
	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/require"
)

func TestMetadataHTTPIntegrationPersistenceAndConflicts(t *testing.T) {
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("requires explicit disposable TEST_POSTGRES_DSN")
	}
	db, err := sql.Open("postgres", dsn)
	require.NoError(t, err)
	defer db.Close()
	store := cassandra.NewPostgresStore(db)
	require.NoError(t, store.EnsureActivationSchema(context.Background()))
	var base int64
	latest, err := store.LatestMetadata(context.Background())
	if err == nil {
		base = latest.Version
	} else {
		require.ErrorIs(t, err, sql.ErrNoRows)
	}
	h := NewHandler(&app.Container{Cassandra: store})
	application := fiber.New()
	// Handler integration uses an already-verified actor; independent router
	// tests exercise auth-master authorization for these exact paths.
	application.Use(func(c *fiber.Ctx) error {
		email := "verified-admin@example.test"
		c.Locals("auth-master-user", infraauth.User{Email: &email})
		return c.Next()
	})
	application.Get("/metadata-versions", h.MetadataVersions)
	application.Get("/metadata-versions/latest", h.LatestMetadata)
	application.Post("/metadata-versions", h.SaveMetadata)
	example := "An illustrative value"
	document := metadata.Document{SchemaVersion: 2, Importable: true, Sheets: []metadata.Sheet{
		{Name: "main", SourceSheets: []string{"Observations"}, Columns: []metadata.Column{{Name: "value", DataType: "text", Search: true, Example: &example}, {Name: "speciesid", DataType: "text"}}},
		{Name: "classification", SourceSheets: []string{"Species"}, Columns: []metadata.Column{{Name: "speciesid", DataType: "text", PrimaryKey: true}}},
	}}
	raw, err := json.Marshal(map[string]any{"base_version": base, "document": document})
	require.NoError(t, err)
	post := func(body []byte) (int, []byte) {
		request := httptest.NewRequest("POST", "/metadata-versions", bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		response, e := application.Test(request)
		require.NoError(t, e)
		defer response.Body.Close()
		var payload json.RawMessage
		require.NoError(t, json.NewDecoder(response.Body).Decode(&payload))
		return response.StatusCode, payload
	}
	status, payload := post(raw)
	require.Equal(t, 201, status, string(payload))
	var saved cassandra.MetadataVersion
	require.NoError(t, json.Unmarshal(payload, &saved))
	require.Greater(t, saved.Version, base)
	require.True(t, saved.Published)
	require.Equal(t, "verified-admin@example.test", saved.CreatedBy)
	require.Equal(t, document, saved.Document)
	defer func() {
		_, e := db.Exec(`DELETE FROM chemdb.metadata_versions WHERE version=$1`, saved.Version)
		require.NoError(t, e)
	}()
	status, _ = post(raw)
	require.Equal(t, 409, status)
	for _, invalid := range [][]byte{[]byte(`{"base_version":0,"document":{"schema_version":1,"importable":true,"sheets":[],"typo":1}}`), []byte(`{"base_version":0,"document":null}`), []byte(`{"document":{}}`), append(raw, []byte(` {}`)...)} {
		status, _ = post(invalid)
		require.Equal(t, 400, status)
	}
	for _, path := range []string{"/metadata-versions", "/metadata-versions/latest"} {
		response, e := application.Test(httptest.NewRequest("GET", path, nil))
		require.NoError(t, e)
		require.Equal(t, 200, response.StatusCode)
		if path == "/metadata-versions/latest" {
			var actual cassandra.MetadataVersion
			require.NoError(t, json.NewDecoder(response.Body).Decode(&actual))
			require.Equal(t, saved, actual)
		} else {
			var all []cassandra.MetadataVersion
			require.NoError(t, json.NewDecoder(response.Body).Decode(&all))
			require.Contains(t, all, saved)
		}
		require.NoError(t, response.Body.Close())
	}
}
