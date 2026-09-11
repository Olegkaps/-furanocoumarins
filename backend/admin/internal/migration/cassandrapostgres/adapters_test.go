package cassandrapostgres

import (
	"testing"

	"github.com/gocql/gocql"
	"github.com/stretchr/testify/require"
)

func TestQuotedQualifiedRejectsUnsafeDynamicTableNames(t *testing.T) {
	got, err := quotedQualified("chemdb.data_2026")
	require.NoError(t, err)
	require.Equal(t, `"chemdb"."data_2026"`, got)
	for _, name := range []string{"chemdb.data;DROP TABLE x", "chemdb.data.more", "chemdb."} {
		_, err := quotedQualified(name)
		require.Error(t, err, name)
	}
}

func TestPostgresTypePreservesSupportedLegacyValues(t *testing.T) {
	for source, target := range map[string]string{
		"text": "text", "uuid": "uuid", "timestamp": "timestamptz", "set<text>": "text[]",
	} {
		got, err := postgresType(source)
		require.NoError(t, err, source)
		require.Equal(t, target, got)
	}
	_, err := postgresType("map<text,text>")
	require.Error(t, err)
}

func TestPostgresArrayAcceptsBothCQLCollectionRepresentations(t *testing.T) {
	for _, value := range []any{[]string{"a", "b"}, map[string]struct{}{"b": {}, "a": {}}} {
		got, err := postgresArray(value)
		require.NoError(t, err)
		require.NotNil(t, got)
	}
	_, err := postgresArray(map[string]string{"a": "b"})
	require.Error(t, err)
}

func TestPostgresValueConvertsCQLUUIDForDatabaseDriver(t *testing.T) {
	uuid := gocql.TimeUUID()
	value, err := postgresValue(column{typ: "uuid"}, uuid)
	require.NoError(t, err)
	require.Equal(t, uuid.String(), value)
}

func TestCanonicalValueMakesSetFingerprintOrderIndependent(t *testing.T) {
	left := canonicalValue(map[string]struct{}{"b": {}, "a": {}})
	right := canonicalValue(map[string]struct{}{"a": {}, "b": {}})
	require.Equal(t, left, right)
	require.Contains(t, left, "set:a")
}
