package cassandra

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"admin/internal/pkg/metadata"
	"github.com/lib/pq"
)

var ErrMetadataConflict = errors.New("metadata changed; reload the latest version before saving")

type MetadataVersion struct {
	Version    int64             `json:"version"`
	Document   metadata.Document `json:"document"`
	CreatedAt  time.Time         `json:"created_at"`
	CreatedBy  string            `json:"created_by"`
	Provenance string            `json:"provenance"`
	Published  bool              `json:"published"`
}

const metadataLock int64 = 684321091
const metadataSelect = `SELECT version,document,created_at,created_by,provenance,published FROM chemdb.metadata_versions`

type rowScanner interface{ Scan(...any) error }

func scanMetadata(row rowScanner) (MetadataVersion, error) {
	var v MetadataVersion
	var raw []byte
	err := row.Scan(&v.Version, &raw, &v.CreatedAt, &v.CreatedBy, &v.Provenance, &v.Published)
	if err == nil {
		err = json.Unmarshal(raw, &v.Document)
	}
	return v, err
}
func (s *Store) LatestMetadata(ctx context.Context) (MetadataVersion, error) {
	if s == nil || s.db == nil {
		return MetadataVersion{}, ErrNotConfigured
	}
	return scanMetadata(s.db.QueryRowContext(ctx, metadataSelect+` WHERE published ORDER BY version DESC LIMIT 1`))
}
func (s *Store) MetadataVersions(ctx context.Context) ([]MetadataVersion, error) {
	if s == nil || s.db == nil {
		return nil, ErrNotConfigured
	}
	rows, err := s.db.QueryContext(ctx, metadataSelect+` ORDER BY version DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MetadataVersion{}
	for rows.Next() {
		v, e := scanMetadata(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) SaveMetadata(ctx context.Context, base int64, document metadata.Document, actor string) (MetadataVersion, error) {
	if s == nil || s.db == nil {
		return MetadataVersion{}, ErrNotConfigured
	}
	if err := document.Validate(); err != nil {
		return MetadataVersion{}, err
	}
	raw, err := json.Marshal(document)
	if err != nil {
		return MetadataVersion{}, err
	}
	if len(raw) > metadata.MaxDocumentBytes {
		return MetadataVersion{}, fmt.Errorf("metadata exceeds 1 MiB")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return MetadataVersion{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, metadataLock); err != nil {
		return MetadataVersion{}, err
	}
	var latest int64
	if err = tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(version),0) FROM chemdb.metadata_versions WHERE published`).Scan(&latest); err != nil {
		return MetadataVersion{}, err
	}
	if latest != base {
		return MetadataVersion{}, ErrMetadataConflict
	}
	v, err := scanMetadata(tx.QueryRowContext(ctx, `INSERT INTO chemdb.metadata_versions(document,created_by,provenance,published) VALUES($1,$2,'admin',true) RETURNING version,document,created_at,created_by,provenance,published`, string(raw), actor))
	if err != nil {
		return v, err
	}
	return v, tx.Commit()
}

// BackfillMetadata versions existing definitions without modifying scientific
// rows. The registry pin is the idempotency marker and is committed atomically.
// A source catalog contains original metadata; a joined public table does not.
func (s *Store) BackfillMetadata(ctx context.Context) error {
	if s == nil || s.db == nil {
		return ErrNotConfigured
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, metadataLock); err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, `SELECT created_at,table_meta,table_data,is_active FROM chemdb.tables WHERE metadata_version IS NULL ORDER BY created_at`)
	if err != nil {
		return err
	}
	type oldTable struct {
		timestamp  time.Time
		meta, data string
		active     bool
	}
	tables := []oldTable{}
	for rows.Next() {
		var t oldTable
		if err = rows.Scan(&t.timestamp, &t.meta, &t.data, &t.active); err != nil {
			rows.Close()
			return err
		}
		tables = append(tables, t)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	var published bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM chemdb.metadata_versions WHERE published)`).Scan(&published); err != nil {
		return err
	}
	var newest, active int64
	for _, t := range tables {
		d, provenance, e := recoverMetadata(ctx, tx, t.meta, t.data)
		if e != nil {
			return fmt.Errorf("backfill metadata for %s: %w", t.data, e)
		}
		raw, e := json.Marshal(d)
		if e != nil {
			return e
		}
		var version int64
		if e = tx.QueryRowContext(ctx, `INSERT INTO chemdb.metadata_versions(document,created_by,provenance,published) VALUES($1,'migration',$2,false) RETURNING version`, string(raw), provenance).Scan(&version); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, `UPDATE chemdb.tables SET metadata_version=$1 WHERE created_at=$2 AND metadata_version IS NULL`, version, t.timestamp); e != nil {
			return e
		}
		if d.Importable {
			newest = version
			if t.active {
				active = version
			}
		}
	}
	if !published {
		if active != 0 {
			newest = active
		}
		if newest != 0 {
			if _, err = tx.ExecContext(ctx, `UPDATE chemdb.metadata_versions SET published=true WHERE version=$1`, newest); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

func recoverMetadata(ctx context.Context, tx *sql.Tx, meta, data string) (metadata.Document, string, error) {
	d := metadata.Document{SchemaVersion: 1, Importable: true, Sheets: []metadata.Sheet{}}
	catalog, err := pgTable(SourceCatalogName(data))
	if err != nil {
		return d, "", err
	}
	var exists bool
	if err = tx.QueryRowContext(ctx, `SELECT to_regclass($1) IS NOT NULL`, catalog).Scan(&exists); err != nil {
		return d, "", err
	}
	provenance := "source_catalog"
	if exists {
		var originalRows [][]string
		var conversionError error
		rows, e := tx.QueryContext(ctx, `SELECT virtual_name,source_sheet_names,columns_json FROM `+catalog+` ORDER BY virtual_name`)
		if e != nil {
			return d, "", e
		}
		for rows.Next() {
			var s metadata.Sheet
			var raw string
			if e = rows.Scan(&s.Name, pq.Array(&s.SourceSheets), &raw); e != nil {
				rows.Close()
				return d, "", e
			}
			sort.Strings(s.SourceSheets)
			if len(s.SourceSheets) > 1 {
				provenance = "source_catalog; physical sheet ordering unavailable (sorted)"
			}
			var legacy [][]string
			if e = json.Unmarshal([]byte(raw), &legacy); e != nil {
				rows.Close()
				return d, "", e
			}
			originalRows = append(originalRows, legacy...)
			for _, source := range s.SourceSheets {
				originalRows = append(originalRows, []string{"__LIST__", source, s.Name, "", ""})
			}
			for _, row := range legacy {
				c, parseErr := metadata.ColumnFromLegacy(row)
				if parseErr != nil {
					conversionError = parseErr
					continue
				}
				s.Columns = append(s.Columns, c)
			}
			d.Sheets = append(d.Sheets, s)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return d, "", e
		}
		e = conversionError
		if e == nil {
			e = d.Validate()
		}
		if e == nil {
			return d, provenance, nil
		}
		// Preserve recoverable declarations even if a historical configuration
		// cannot satisfy today's import contract. It must not become latest.
		d.Importable = false
		d.LegacyMetadata = originalRows
		return d, provenance + "; requires administrator repair: " + e.Error(), nil
	}
	d.Importable = false
	q, err := pgTable(meta)
	if err != nil {
		return d, "", err
	}
	if err = tx.QueryRowContext(ctx, `SELECT to_regclass($1) IS NOT NULL`, q).Scan(&exists); err != nil {
		return d, "", err
	}
	if !exists {
		return d, "legacy metadata table unavailable", nil
	}
	// to_jsonb supports both v1 metadata (no label) and v2 without guessing
	// source sheet mappings or primary/external relationships from joined data.
	rows, err := tx.QueryContext(ctx, `SELECT to_jsonb(m) FROM `+q+` m`)
	if err != nil {
		return d, "", err
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		if err = rows.Scan(&raw); err != nil {
			return d, "", err
		}
		var item map[string]string
		if err = json.Unmarshal(raw, &item); err != nil {
			return d, "", err
		}
		d.LegacyMetadata = append(d.LegacyMetadata, []string{item["sheet"], item["column"], item["type"], item["description"], item["show_name"]})
	}
	sort.Slice(d.LegacyMetadata, func(i, j int) bool { return d.LegacyMetadata[i][1] < d.LegacyMetadata[j][1] })
	return d, "legacy public metadata only; original source mappings and keys unavailable", rows.Err()
}
