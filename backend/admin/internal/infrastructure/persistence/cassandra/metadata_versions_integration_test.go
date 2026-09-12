//go:build integration

package cassandra

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"sync"
	"testing"
	"time"

	"admin/internal/pkg/metadata"
	"github.com/lib/pq"
	"github.com/stretchr/testify/require"
)

func metadataFixture() metadata.Document {
	return metadata.Document{SchemaVersion: 1, Importable: true, Sheets: []metadata.Sheet{
		{Name: "main", SourceSheets: []string{"Observations"}, Columns: []metadata.Column{{Name: "speciesid", DataType: "text", ExternalSheet: "classification"}}},
		{Name: "classification", SourceSheets: []string{"Species"}, Columns: []metadata.Column{{Name: "speciesid", DataType: "text", PrimaryKey: true}, {Name: "tags", DataType: "set", Search: true}}},
	}}
}

func TestMetadataVersionIntegrationConcurrentSaveAndBackfill(t *testing.T) {
	if os.Getenv("TEST_POSTGRES_DSN") == "" {
		t.Skip("requires explicit disposable TEST_POSTGRES_DSN")
	}
	db := postgresIntegrationDB(t)
	ctx := context.Background()
	store := NewPostgresStore(db)
	require.NoError(t, store.EnsureActivationSchema(ctx))
	before, err := store.MetadataVersions(ctx)
	require.NoError(t, err)
	var base int64
	latest, err := store.LatestMetadata(ctx)
	if err == nil {
		base = latest.Version
	} else {
		require.ErrorIs(t, err, sql.ErrNoRows)
	}
	// Cleanup only test-owned versions and rows; never truncate shared tables.
	var ownVersions []int64
	t.Cleanup(func() {
		for _, id := range ownVersions {
			_, e := db.Exec(`DELETE FROM chemdb.metadata_versions WHERE version=$1`, id)
			require.NoError(t, e)
		}
	})
	var wg sync.WaitGroup
	results := make(chan error, 2)
	versions := make(chan int64, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			v, e := store.SaveMetadata(ctx, base, metadataFixture(), "test-admin")
			if e == nil {
				versions <- v.Version
			}
			results <- e
		}()
	}
	wg.Wait()
	close(results)
	close(versions)
	wins, conflicts := 0, 0
	for e := range results {
		if e == nil {
			wins++
		} else {
			require.ErrorIs(t, e, ErrMetadataConflict)
			conflicts++
		}
	}
	require.Equal(t, 1, wins)
	require.Equal(t, 1, conflicts)
	for id := range versions {
		ownVersions = append(ownVersions, id)
	}
	first, err := store.LatestMetadata(ctx)
	require.NoError(t, err)
	require.Equal(t, "test-admin", first.CreatedBy)
	updated := metadataFixture()
	updated.Sheets[1].Columns[1].Hidden = true
	second, err := store.SaveMetadata(ctx, first.Version, updated, "next-admin")
	require.NoError(t, err)
	ownVersions = append(ownVersions, second.Version)
	require.False(t, first.Document.Sheets[1].Columns[1].Hidden, "captured metadata snapshot must remain unchanged")
	stamp := time.Now().UTC().Truncate(time.Microsecond)
	data := "chemdb.data_metadata_" + stamp.Format("20060102150405")
	catalog := SourceCatalogName(data)
	q, err := pgTable(catalog)
	require.NoError(t, err)
	_, err = db.Exec(`CREATE TABLE ` + q + ` (virtual_name text PRIMARY KEY,source_sheet_names text[],columns_json text)`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, e := db.Exec(`DELETE FROM chemdb.tables WHERE created_at >=$1 AND created_at <=$2`, stamp, stamp.Add(2*time.Second))
		require.NoError(t, e)
		_, e = db.Exec(`DROP TABLE ` + q)
		require.NoError(t, e)
	})
	doc := metadataFixture()
	for _, sheet := range doc.Sheets {
		var rows [][]string
		for _, c := range sheet.Columns {
			rows = append(rows, []string{sheet.Name, c.Name, c.LegacyType(), c.Description, c.Label})
		}
		raw, e := json.Marshal(rows)
		require.NoError(t, e)
		_, e = db.Exec(`INSERT INTO `+q+` VALUES($1,$2,$3)`, sheet.Name, pq.Array(sheet.SourceSheets), string(raw))
		require.NoError(t, e)
	}
	for i := range 2 {
		_, err = db.Exec(`INSERT INTO chemdb.tables(created_at,name,version,table_meta,table_data,table_species,is_ok,is_active) VALUES($1,'legacy','v2','chemdb.absent_meta',$2,'chemdb.absent_species',true,false)`, stamp.Add(time.Duration(i)*time.Second), data)
		require.NoError(t, err)
	}
	require.NoError(t, store.BackfillMetadata(ctx))
	var pin int64
	require.NoError(t, db.QueryRow(`SELECT metadata_version FROM chemdb.tables WHERE created_at=$1`, stamp).Scan(&pin))
	history, err := store.MetadataVersions(ctx)
	require.NoError(t, err)
	require.Len(t, history, len(before)+4)
	for _, v := range history {
		if v.Version == pin {
			require.True(t, v.Document.Importable)
			require.False(t, v.Published)
			require.ElementsMatch(t, doc.Sheets, v.Document.Sheets)
		}
		if v.Version > second.Version {
			ownVersions = append(ownVersions, v.Version)
		}
	}
	require.NoError(t, store.BackfillMetadata(ctx))
	again, err := store.MetadataVersions(ctx)
	require.NoError(t, err)
	require.Equal(t, history, again)
	// Historical nonnumeric classification is preserved, never fatal to startup.
	_, err = db.Exec(`UPDATE `+q+` SET columns_json=$1 WHERE virtual_name='classification'`, `[["classification","speciesid","primary clas[family]","",""],["classification","tags","set search","",""]]`)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO chemdb.tables(created_at,name,version,table_meta,table_data,table_species,is_ok,is_active) VALUES($1,'unrepresentable','v2','chemdb.absent_meta',$2,'chemdb.absent_species',true,false)`, stamp.Add(2*time.Second), data)
	require.NoError(t, err)
	require.NoError(t, store.BackfillMetadata(ctx))
	require.NoError(t, db.QueryRow(`SELECT metadata_version FROM chemdb.tables WHERE created_at=$1`, stamp.Add(2*time.Second)).Scan(&pin))
	ownVersions = append(ownVersions, pin)
	v, err := scanMetadata(db.QueryRow(metadataSelect+` WHERE version=$1`, pin))
	require.NoError(t, err)
	require.False(t, v.Document.Importable)
	require.False(t, v.Published)
	require.NotEmpty(t, v.Document.LegacyMetadata)
	current, err := store.LatestMetadata(ctx)
	require.NoError(t, err)
	require.Equal(t, second.Version, current.Version)
}
