package cassandra

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"time"

	"admin/internal/autocomplete"
	"admin/internal/chemistry"
	"admin/internal/pkg/metadata"
	"github.com/lib/pq"
)

// Increment whenever feature semantics or the RDKit parser version changes.
var structureFeatureVersion = fmt.Sprintf("paths-rdkit2022-v%d", chemistry.FingerprintVersion)

const structureIndexSchema = `
CREATE TABLE IF NOT EXISTS chemdb.structure_index_versions (
 dataset text PRIMARY KEY,
 owner timestamptz NOT NULL REFERENCES chemdb.tables(created_at) ON DELETE CASCADE,
 revision text NOT NULL
);
CREATE TABLE IF NOT EXISTS chemdb.structure_candidates (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 dataset text NOT NULL REFERENCES chemdb.structure_index_versions(dataset) ON DELETE CASCADE,
 column_name text NOT NULL,
 smiles text NOT NULL,
 atom_count integer NOT NULL,
 bond_count integer NOT NULL,
 screenable boolean NOT NULL,
 fp0 integer[] NOT NULL,
 fp1 integer[] NOT NULL,
 fp2 integer[] NOT NULL,
 fp3 integer[] NOT NULL
);
CREATE INDEX IF NOT EXISTS structure_candidates_dataset ON chemdb.structure_candidates(dataset,column_name,id);
CREATE INDEX IF NOT EXISTS structure_candidates_unscreenable ON chemdb.structure_candidates(dataset,column_name,id) WHERE NOT screenable;
CREATE INDEX IF NOT EXISTS structure_candidates_fp0 ON chemdb.structure_candidates USING gin(fp0);
CREATE INDEX IF NOT EXISTS structure_candidates_fp1 ON chemdb.structure_candidates USING gin(fp1);
CREATE INDEX IF NOT EXISTS structure_candidates_fp2 ON chemdb.structure_candidates USING gin(fp2);
CREATE INDEX IF NOT EXISTS structure_candidates_fp3 ON chemdb.structure_candidates USING gin(fp3);
`

func structureColumns(ctx context.Context, db interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, meta string) ([]autocomplete.Suggestion, error) {
	name, err := pgTable(meta)
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT "column",show_name,type FROM `+name+` ORDER BY "column"`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []autocomplete.Suggestion{}
	for rows.Next() {
		var c autocomplete.Suggestion
		if err = rows.Scan(&c.Column, &c.ShowName, &c.Type); err != nil {
			return nil, err
		}
		parsed, e := metadata.ColumnFromLegacy([]string{"", c.Column, c.Type, "", ""})
		if e != nil {
			return nil, e
		}
		if parsed.Smiles {
			c.Group = "chemicals"
			if c.ShowName == "" {
				c.ShowName = c.Column
			}
			out = append(out, c)
		}
	}
	return out, rows.Err()
}

// Scientific datasets are immutable. Bibliography generations do not invalidate chemistry.
func (s *Store) structureVersion(ctx context.Context) (string, string, string, error) {
	var data, meta, key string
	err := s.db.QueryRowContext(ctx, `SELECT table_data,table_meta,created_at::text||':'||version FROM chemdb.tables WHERE is_active AND is_ok`).Scan(&data, &meta, &key)
	return data, meta, key, err
}

// BuildStructureIndex atomically publishes a complete persistent generation.
// Failed/interrupted builds roll back; replicas serialize builds with a DB lock.
func (s *Store) BuildStructureIndex(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var dataset, meta, revision string
	var owner time.Time
	err = tx.QueryRowContext(ctx, `SELECT table_data,table_meta,created_at,created_at::text||':'||version FROM chemdb.tables WHERE is_active AND is_ok`).Scan(&dataset, &meta, &owner, &revision)
	if err != nil {
		return err
	}
	revision += ":" + structureFeatureVersion
	var locked bool
	if err = tx.QueryRowContext(ctx, `SELECT pg_try_advisory_xact_lock(hashtextextended($1,9123))`, dataset).Scan(&locked); err != nil {
		return err
	}
	if !locked {
		return chemistry.ErrBusy
	}
	var current string
	err = tx.QueryRowContext(ctx, `SELECT revision FROM chemdb.structure_index_versions WHERE dataset=$1`, dataset).Scan(&current)
	if err == nil && current == revision {
		return tx.Commit()
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO chemdb.structure_index_versions(dataset,owner,revision) VALUES($1,$2,$3) ON CONFLICT(dataset) DO UPDATE SET revision=EXCLUDED.revision,owner=EXCLUDED.owner`, dataset, owner, revision); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM chemdb.structure_candidates WHERE dataset=$1`, dataset); err != nil {
		return err
	}
	columns, err := structureColumns(ctx, tx, meta)
	if err != nil {
		return err
	}
	data, err := pgTable(dataset)
	if err != nil {
		return err
	}
	for _, column := range columns {
		col, e := pgColumn(column.Column)
		if e != nil {
			return e
		}
		// A server cursor computes distinct values once, then streams bounded batches.
		_, e = tx.ExecContext(ctx, `DECLARE structure_values NO SCROLL CURSOR FOR SELECT DISTINCT member.value FROM `+data+` CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(to_jsonb(`+col+`))='array' THEN to_jsonb(`+col+`) ELSE jsonb_build_array(`+col+`) END) member(value) WHERE member.value IS NOT NULL AND member.value<>'' ORDER BY 1`)
		if e != nil {
			return e
		}
		for {
			rows, e := tx.QueryContext(ctx, "FETCH FORWARD 128 FROM structure_values")
			if e != nil {
				return e
			}
			values := []string{}
			for rows.Next() {
				var v string
				if e = rows.Scan(&v); e != nil {
					_ = rows.Close()
					return e
				}
				values = append(values, v)
			}
			e = errors.Join(rows.Err(), rows.Close())
			if e != nil {
				return e
			}
			if len(values) == 0 {
				break
			}
			features, e := chemistry.Fingerprints(ctx, values)
			if e != nil {
				return e
			}
			copyStmt, e := tx.PrepareContext(ctx, pq.CopyInSchema("chemdb", "structure_candidates", "dataset", "column_name", "smiles", "atom_count", "bond_count", "screenable", "fp0", "fp1", "fp2", "fp3"))
			if e != nil {
				return e
			}
			for n, f := range features {
				if !f.Valid {
					continue
				}
				_, e = copyStmt.ExecContext(ctx, dataset, column.Column, values[n], f.Atoms, f.Bonds, f.Screenable, pq.Array(nonNilFeatures(f.Modes[0])), pq.Array(nonNilFeatures(f.Modes[1])), pq.Array(nonNilFeatures(f.Modes[2])), pq.Array(nonNilFeatures(f.Modes[3])))
				if e != nil {
					// COPY receives responses asynchronously. Drain it before rollback
					// can read from the same connection, including row-write failures.
					return errors.Join(e, copyStmt.Close())
				}
			}
			if _, e = copyStmt.ExecContext(ctx); e != nil {
				return errors.Join(e, copyStmt.Close())
			}
			if e = copyStmt.Close(); e != nil {
				return e
			}
		}
		if _, e = tx.ExecContext(ctx, "CLOSE structure_values"); e != nil {
			return e
		}
	}
	return tx.Commit()
}
func nonNilFeatures(features []int32) []int32 {
	if features == nil {
		return []int32{}
	}
	return features
}

func (s *Store) ensureStructureIndex(ctx context.Context, dataset, revision string) error {
	var ready bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM chemdb.structure_index_versions WHERE dataset=$1 AND revision=$2)`, dataset, revision+":"+structureFeatureVersion).Scan(&ready)
	if err != nil {
		return err
	}
	if ready {
		return nil
	}
	if s.structureBuild.TryLock() {
		go func() {
			defer s.structureBuild.Unlock()
			buildCtx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
			defer cancel()
			if err := s.BuildStructureIndex(buildCtx); err != nil && !errors.Is(err, chemistry.ErrBusy) {
				log.Printf("structure index build failed: %v", err)
			}
		}()
	}
	return fmt.Errorf("persistent structure index is building: %w", chemistry.ErrBusy)
}

// searchStructures screens in PostgreSQL first; only candidate batches enter
// native workers. Full searches reject overflow rather than silently truncate.
func (s *Store) searchStructures(ctx context.Context, value string, columns []string, limit int, opts chemistry.Options, scope bool, expectedDataset string) ([]autocomplete.Suggestion, error) {
	if s.db == nil {
		return nil, ErrNotConfigured
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	query, err := chemistry.QueryFingerprint(ctx, value, opts)
	if err != nil {
		return nil, err
	}
	dataset, meta, revision, err := s.structureVersion(ctx)
	if err != nil {
		return nil, err
	}
	if expectedDataset != "" && expectedDataset != dataset {
		return nil, chemistry.ErrBusy
	}
	metas, err := structureColumns(ctx, s.db, meta)
	if err != nil {
		return nil, err
	}
	selected := []autocomplete.Suggestion{}
	for _, name := range columns {
		found := false
		for _, m := range metas {
			if m.Column == name {
				found = true
			}
		}
		if !found {
			return nil, fmt.Errorf("unknown SMILES column %q", name)
		}
	}
	for _, m := range metas {
		include := len(columns) == 0
		for _, name := range columns {
			if name == m.Column {
				include = true
			}
		}
		if include {
			selected = append(selected, m)
		}
	}
	if err = s.ensureStructureIndex(ctx, dataset, revision); err != nil {
		return nil, err
	}
	mode := chemistry.FingerprintMode(opts)
	// Validated mode is an integer enum, never user-supplied SQL.
	field := fmt.Sprintf("fp%d", mode)
	out := []autocomplete.Suggestion{}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	var snapshotRevision string
	if err = tx.QueryRowContext(ctx, "SELECT revision FROM chemdb.structure_index_versions WHERE dataset=$1", dataset).Scan(&snapshotRevision); err != nil {
		return nil, err
	}
	if snapshotRevision != revision+":"+structureFeatureVersion {
		return nil, chemistry.ErrBusy
	}
	for _, column := range selected {
		statement := `SELECT id,smiles FROM chemdb.structure_candidates WHERE dataset=$1 AND column_name=$2`
		args := []any{dataset, column.Column}
		if query.Screenable {
			// Disjoint branches let PostgreSQL use GIN for features and the partial
			// fallback index; OR NOT screenable would force a sequential scan.
			statement += ` AND screenable AND atom_count >= $3 AND bond_count >= $4 AND ` + field + ` @> $5::integer[] UNION ALL SELECT id,smiles FROM chemdb.structure_candidates WHERE dataset=$1 AND column_name=$2 AND NOT screenable`
			args = append(args, query.Atoms, query.Bonds, pq.Array(nonNilFeatures(query.Modes[mode])))
		}
		if _, err = tx.ExecContext(ctx, "DECLARE structure_matches NO SCROLL CURSOR FOR "+statement+" ORDER BY id", args...); err != nil {
			return nil, err
		}
		for {
			rows, e := tx.QueryContext(ctx, "FETCH FORWARD 128 FROM structure_matches")
			if e != nil {
				return nil, e
			}
			values := []string{}
			for rows.Next() {
				var v string
				var candidateID int64
				if e = rows.Scan(&candidateID, &v); e != nil {
					_ = rows.Close()
					return nil, e
				}
				values = append(values, v)
			}
			e = errors.Join(rows.Err(), rows.Close())
			if e != nil {
				return nil, e
			}
			if len(values) == 0 {
				break
			}
			index, e := chemistry.NewWorkerIndex(ctx, values)
			if e != nil {
				return nil, e
			}
			matches, e := index.Search(ctx, value, opts, 128)
			index.Close()
			if e != nil {
				return nil, e
			}
			for _, match := range matches {
				entry := column
				entry.Value = match
				out = append(out, entry)
				if expectedDataset == "" && len(out) >= limit {
					break
				}
				if len(out) > limit {
					return nil, fmt.Errorf("substructure search exceeds %d matching values; narrow the query", limit)
				}
			}
			if expectedDataset == "" && len(out) >= limit {
				break
			}
		}
		if _, err = tx.ExecContext(ctx, "CLOSE structure_matches"); err != nil {
			return nil, err
		}
		if expectedDataset == "" && len(out) >= limit {
			break
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	_, _, current, err := s.structureVersion(ctx)
	if err != nil {
		return nil, err
	}
	if current != revision {
		return nil, chemistry.ErrBusy
	}
	return out, nil
}
