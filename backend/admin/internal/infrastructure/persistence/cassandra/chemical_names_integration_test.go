//go:build integration

package cassandra

import (
	"context"
	"fmt"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestChemicalNameMembershipPostgres(t *testing.T) {
	db := postgresIntegrationDB(t)
	s := NewPostgresStore(db)
	name := fmt.Sprintf("chemdb.alias_members_%d", time.Now().UnixNano())
	quoted, err := pgTable(name)
	require.NoError(t, err)
	_, err = db.Exec("CREATE TABLE " + quoted + " (id text, names text, species text)")
	require.NoError(t, err)
	defer db.Exec("DROP TABLE " + quoted)
	for _, row := range [][3]string{{"1", "Umbelliferone= Skimmetine =Hydrangine", "a"}, {"2", "Skimmetine=Other", "b"}, {"3", "Byakangelicin=5-O-Methyl heraclenol, (+),2''R", "a"}, {"4", "NotSkimmetine", "a"}, {"5", "= =", "a"}} {
		_, err = db.Exec("INSERT INTO "+quoted+" VALUES ($1,$2,$3)", row[0], row[1], row[2])
		require.NoError(t, err)
	}
	_, err = db.Exec("INSERT INTO " + quoted + " (id) VALUES ('null')")
	require.NoError(t, err)
	for _, tc := range []struct {
		q     string
		count int
	}{{"names CONTAINS 'Skimmetine'", 2}, {"names CONTAINS 'Skimmetine' AND species = 'a'", 1}, {"names CONTAINS 'Skimmetine' OR id = '3'", 3}, {"names CONTAINS '5-O-Methyl heraclenol, (+),2''''R'", 1}, {"names CONTAINS 'Other'", 1}, {"names CONTAINS ''", 0}, {"names CONTAINS 'missing'", 0}, {"names = 'Skimmetine'", 0}, {"names = 'Skimmetine=Other'", 1}} {
		got, err := s.pgSearchWhere(context.Background(), name, "id,names", tc.q, nil, map[string]bool{"names": true})
		require.NoError(t, err, tc.q)
		require.Len(t, got, tc.count, tc.q)
	}
}
