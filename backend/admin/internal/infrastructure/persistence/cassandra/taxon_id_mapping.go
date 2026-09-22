package cassandra

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

var ErrTaxonIDMappingConflict = errors.New("taxon ID mapping changed; reload the latest version before saving")

type TaxonIDMappingConfig struct {
	Sheet      string            `json:"sheet"`
	NameColumn string            `json:"name_column"`
	RankColumn string            `json:"rank_column"`
	IDColumns  map[string]string `json:"id_columns"`
}
type TaxonIDMappingVersion struct {
	Version   int64                `json:"version"`
	Config    TaxonIDMappingConfig `json:"config"`
	RowCount  int                  `json:"row_count"`
	CreatedAt time.Time            `json:"created_at"`
	CreatedBy string               `json:"created_by"`
}
type TaxonIDMappingRow struct {
	Rank int
	Name string
	IDs  map[string]string
}

const taxonIDMappingLock int64 = 684321092

func scanTaxonIDMapping(row interface{ Scan(...any) error }) (TaxonIDMappingVersion, error) {
	var v TaxonIDMappingVersion
	var raw []byte
	err := row.Scan(&v.Version, &raw, &v.RowCount, &v.CreatedAt, &v.CreatedBy)
	if err == nil {
		err = json.Unmarshal(raw, &v.Config)
	}
	return v, err
}
func (s *Store) LatestTaxonIDMapping(ctx context.Context) (TaxonIDMappingVersion, error) {
	if s == nil || s.db == nil {
		return TaxonIDMappingVersion{}, ErrNotConfigured
	}
	return scanTaxonIDMapping(s.db.QueryRowContext(ctx, `SELECT v.version,v.config,v.row_count,v.created_at,v.created_by FROM chemdb.taxon_id_mapping_current c JOIN chemdb.taxon_id_mapping_versions v ON v.version=c.version`))
}
func (s *Store) SaveTaxonIDMapping(ctx context.Context, base int64, config TaxonIDMappingConfig, rows []TaxonIDMappingRow, actor string) (TaxonIDMappingVersion, error) {
	if s == nil || s.db == nil {
		return TaxonIDMappingVersion{}, ErrNotConfigured
	}
	raw, err := json.Marshal(config)
	if err != nil {
		return TaxonIDMappingVersion{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return TaxonIDMappingVersion{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, taxonIDMappingLock); err != nil {
		return TaxonIDMappingVersion{}, err
	}
	var latest int64
	if err = tx.QueryRowContext(ctx, `SELECT COALESCE((SELECT version FROM chemdb.taxon_id_mapping_current WHERE id),0)`).Scan(&latest); err != nil {
		return TaxonIDMappingVersion{}, err
	}
	if latest != base {
		return TaxonIDMappingVersion{}, ErrTaxonIDMappingConflict
	}
	v, err := scanTaxonIDMapping(tx.QueryRowContext(ctx, `INSERT INTO chemdb.taxon_id_mapping_versions(config,row_count,created_by) VALUES($1,$2,$3) RETURNING version,config,row_count,created_at,created_by`, raw, len(rows), actor))
	if err != nil {
		return TaxonIDMappingVersion{}, err
	}
	for _, item := range rows {
		ids, e := json.Marshal(item.IDs)
		if e != nil {
			return TaxonIDMappingVersion{}, e
		}
		if _, e = tx.ExecContext(ctx, `INSERT INTO chemdb.taxon_id_mapping_rows(version,rank,name,ids) VALUES($1,$2,$3,$4)`, v.Version, item.Rank, item.Name, ids); e != nil {
			return TaxonIDMappingVersion{}, e
		}
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO chemdb.taxon_id_mapping_current(id,version) VALUES(true,$1) ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version`, v.Version); err != nil {
		return TaxonIDMappingVersion{}, err
	}
	return v, tx.Commit()
}
func (s *Store) TaxonExternalIDs(ctx context.Context, rank int, name string) (int64, map[string]string, error) {
	if s == nil || s.db == nil {
		return 0, nil, ErrNotConfigured
	}
	var version int64
	var raw []byte
	err := s.db.QueryRowContext(ctx, `SELECT c.version,r.ids FROM chemdb.taxon_id_mapping_current c LEFT JOIN chemdb.taxon_id_mapping_rows r ON r.version=c.version AND r.rank=$1 AND r.name=$2`, rank, name).Scan(&version, &raw)
	if err == sql.ErrNoRows {
		return 0, map[string]string{}, nil
	}
	if err != nil {
		return 0, nil, err
	}
	ids := map[string]string{}
	if raw != nil {
		err = json.Unmarshal(raw, &ids)
	}
	return version, ids, err
}
