package cassandra

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestTaxonAvailabilityKeyUsesSourceIDWhenAvailable(t *testing.T) {
	require.Equal(t, "source:species-42", TaxonAvailabilityKey(&Taxon{TaxonLink: TaxonLink{Rank: 0, Name: "communis", ID: "species-42"}}))
	require.Equal(t, "rank:1:name:Heracleum", TaxonAvailabilityKey(&Taxon{TaxonLink: TaxonLink{Rank: 1, Name: "Heracleum"}}))
}

func TestUpsertTaxonAvailabilityChecksActiveDatasetAndKeepsOtherSnapshots(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	dataset := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT created_at FROM chemdb.tables WHERE is_active AND is_ok FOR SHARE`)).WillReturnRows(sqlmock.NewRows([]string{"created_at"}).AddRow(dataset))
	mock.ExpectExec(`INSERT INTO chemdb\.taxon_availability_snapshots`).
		WithArgs(dataset, 0, "source:species-42", "ncbi", "genome", "9606", int64(7), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	err = NewPostgresStore(db).UpsertTaxonAvailability(context.Background(), dataset, &Taxon{TaxonLink: TaxonLink{Rank: 0, ID: "species-42"}}, []TaxonAvailability{{Source: "ncbi", Type: "genome", ExternalTaxID: "9606", Count: 7}})
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestUpsertTaxonAvailabilityRejectsDatasetActivationRace(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	expected := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT created_at FROM chemdb.tables WHERE is_active AND is_ok FOR SHARE`)).WillReturnRows(sqlmock.NewRows([]string{"created_at"}).AddRow(expected.Add(time.Second)))
	mock.ExpectRollback()
	err = NewPostgresStore(db).UpsertTaxonAvailability(context.Background(), expected, &Taxon{TaxonLink: TaxonLink{Rank: 0, ID: "species-42"}}, []TaxonAvailability{{Source: "ncbi", Type: "genome", ExternalTaxID: "9606", Count: 7}})
	require.ErrorIs(t, err, ErrTaxonAvailabilityDatasetChanged)
	require.NoError(t, mock.ExpectationsWereMet())
}
