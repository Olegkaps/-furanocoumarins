package cassandra

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// TaxonAvailability is a browser-observed provider-tree count. It is not a
// curated scientific assertion and remains scoped to the dataset that supplied
// the local taxon identity.
type TaxonAvailability struct {
	Source string `json:"source"`
	Type   string `json:"type"`
	// Legacy wire/storage name: taxonomy ID or an explicit organism:<name> query identity.
	ExternalTaxID string    `json:"external_taxid"`
	Count         int64     `json:"count"`
	CheckedAt     time.Time `json:"checked_at"`
	Provenance    string    `json:"provenance"`
}

const taxonAvailabilityProvenance = "browser_observed"

func TaxonAvailabilityKey(taxon *Taxon) string {
	if taxon.ID != "" {
		return "source:" + taxon.ID
	}
	return fmt.Sprintf("rank:%d:name:%s", taxon.Rank, taxon.Name)
}

func (s *Store) TaxonAvailability(ctx context.Context, dataset time.Time, taxon *Taxon) ([]TaxonAvailability, error) {
	if s == nil || s.db == nil {
		return nil, ErrNotConfigured
	}
	rows, err := s.db.QueryContext(ctx, `SELECT source,snapshot_type,external_taxid,count,checked_at
FROM chemdb.taxon_availability_snapshots
WHERE dataset=$1 AND rank=$2 AND taxon_key=$3
ORDER BY source,snapshot_type,external_taxid`, dataset, taxon.Rank, TaxonAvailabilityKey(taxon))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []TaxonAvailability{}
	for rows.Next() {
		var item TaxonAvailability
		if err := rows.Scan(&item.Source, &item.Type, &item.ExternalTaxID, &item.Count, &item.CheckedAt); err != nil {
			return nil, err
		}
		item.Provenance = taxonAvailabilityProvenance
		result = append(result, item)
	}
	return result, rows.Err()
}

// UpsertTaxonAvailability writes only the supplied provider/type/taxon count.
// It locks and rechecks the active dataset, so an admin cannot accidentally
// attach a stale browser snapshot after a dataset activation.
func (s *Store) UpsertTaxonAvailability(ctx context.Context, expectedDataset time.Time, taxon *Taxon, snapshots []TaxonAvailability) error {
	if s == nil || s.db == nil {
		return ErrNotConfigured
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var active time.Time
	err = tx.QueryRowContext(ctx, `SELECT created_at FROM chemdb.tables WHERE is_active AND is_ok FOR SHARE`).Scan(&active)
	if err == sql.ErrNoRows {
		return ErrTaxonAvailabilityDatasetChanged
	}
	if err != nil {
		return err
	}
	if !active.Equal(expectedDataset) {
		return ErrTaxonAvailabilityDatasetChanged
	}
	checkedAt := time.Now().UTC()
	for _, snapshot := range snapshots {
		_, err = tx.ExecContext(ctx, `INSERT INTO chemdb.taxon_availability_snapshots
(dataset,rank,taxon_key,source,snapshot_type,external_taxid,count,checked_at)
VALUES($1,$2,$3,$4,$5,$6,$7,$8)
ON CONFLICT(dataset,rank,taxon_key,source,snapshot_type,external_taxid)
DO UPDATE SET count=EXCLUDED.count, checked_at=EXCLUDED.checked_at`,
			expectedDataset, taxon.Rank, TaxonAvailabilityKey(taxon), strings.TrimSpace(snapshot.Source), strings.TrimSpace(snapshot.Type), strings.TrimSpace(snapshot.ExternalTaxID), snapshot.Count, checkedAt)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

var ErrTaxonAvailabilityDatasetChanged = fmt.Errorf("active dataset changed; refresh availability before saving")
