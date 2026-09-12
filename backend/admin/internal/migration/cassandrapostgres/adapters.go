package cassandrapostgres

// This file contains the concrete, offline-only cutover adapters. Cassandra
// is intentionally opened only by this command and is never wired into the
// HTTP application.

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	"admin/internal/infrastructure/persistence/cassandra"

	"github.com/gocql/gocql"
	"github.com/lib/pq"
)

type column struct {
	name, typ string
	key       bool
	position  int
}

func quotedQualified(name string) (string, error) {
	parts := strings.Split(name, ".")
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid legacy table name %q", name)
	}
	for _, p := range parts {
		if p == "" {
			return "", fmt.Errorf("invalid legacy table name %q", name)
		}
		for _, r := range p {
			if !(r == '_' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9') {
				return "", fmt.Errorf("unsafe legacy identifier %q", name)
			}
		}
	}
	return pq.QuoteIdentifier(parts[0]) + "." + pq.QuoteIdentifier(parts[1]), nil
}

func postgresType(cql string) (string, error) {
	switch strings.ToLower(cql) {
	case "text", "varchar", "ascii":
		return "text", nil
	case "uuid", "timeuuid":
		return "uuid", nil
	case "timestamp":
		return "timestamptz", nil
	case "boolean":
		return "boolean", nil
	case "int":
		return "integer", nil
	case "bigint", "counter":
		return "bigint", nil
	case "float":
		return "real", nil
	case "double":
		return "double precision", nil
	case "set<text>", "list<text>":
		return "text[]", nil
	default:
		return "", fmt.Errorf("unsupported Cassandra type %q", cql)
	}
}

func legacyColumns(ctx context.Context, session *gocql.Session, table string) ([]column, error) {
	parts := strings.Split(table, ".")
	// Legacy workbook tables were created with unquoted CQL identifiers; CQL
	// folds their timestamp's uppercase T even though registry values retain it.
	iter := session.Query(`SELECT column_name, kind, position, type FROM system_schema.columns WHERE keyspace_name=? AND table_name=?`, strings.ToLower(parts[0]), strings.ToLower(parts[1])).WithContext(ctx).Iter()
	var out []column
	var name, kind, typ string
	var pos int
	for iter.Scan(&name, &kind, &pos, &typ) {
		out = append(out, column{name: name, typ: typ, key: kind == "partition_key" || kind == "clustering", position: pos})
	}
	if err := iter.Close(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("legacy table %s has no schema", table)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].name < out[j].name })
	return out, nil
}

func postgresValue(c column, value any) (any, error) {
	if c.typ == "set<text>" || c.typ == "list<text>" {
		return postgresArray(value)
	}
	if c.typ == "uuid" || c.typ == "timeuuid" {
		if uuid, ok := value.(gocql.UUID); ok {
			return uuid.String(), nil
		}
	}
	return value, nil
}

func copyDynamicTable(ctx context.Context, session *gocql.Session, db *sql.DB, name, expectedChecksum string, expectedRows int64) (int64, error) {
	qname, err := quotedQualified(name)
	if err != nil {
		return 0, err
	}
	cols, err := legacyColumns(ctx, session, name)
	if err != nil {
		return 0, err
	}
	defs, names, keys := make([]string, 0, len(cols)), make([]string, 0, len(cols)), []string{}
	for _, c := range cols {
		typ, err := postgresType(c.typ)
		if err != nil {
			return 0, fmt.Errorf("%s.%s: %w", name, c.name, err)
		}
		quoted := pq.QuoteIdentifier(c.name)
		names = append(names, quoted)
		defs = append(defs, quoted+" "+typ)
		if c.key {
			keys = append(keys, quoted)
		}
	}
	if len(keys) == 0 {
		return 0, fmt.Errorf("legacy table %s has no primary key", name)
	}
	var existed bool
	if err = db.QueryRowContext(ctx, `SELECT to_regclass($1) IS NOT NULL`, qname).Scan(&existed); err != nil {
		return 0, err
	}
	if _, err = db.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS "+qname+" ("+strings.Join(defs, ",")+", PRIMARY KEY ("+strings.Join(keys, ",")+"))"); err != nil {
		return 0, err
	}
	if existed {
		var targetRows int64
		if err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+qname).Scan(&targetRows); err != nil {
			return 0, err
		}
		if targetRows != 0 {
			return 0, fmt.Errorf("target table %s has untracked rows", name)
		}
	}
	selectNames := make([]string, len(cols))
	for i, c := range cols {
		selectNames[i] = pq.QuoteIdentifier(c.name)
	}
	iter := session.Query("SELECT " + strings.Join(selectNames, ",") + " FROM " + name).WithContext(ctx).Iter()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	args := make([]any, len(cols))
	params := make([]string, len(cols))
	for i := range params {
		params[i] = fmt.Sprintf("$%d", i+1)
	}
	insert := "INSERT INTO " + qname + " (" + strings.Join(names, ",") + ") VALUES (" + strings.Join(params, ",") + ") ON CONFLICT DO NOTHING"
	var count int64
	row := map[string]interface{}{}
	for iter.MapScan(row) {
		for i, c := range cols {
			args[i], err = postgresValue(c, row[c.name])
			if err != nil {
				iter.Close()
				return 0, err
			}
		}
		if _, err = tx.ExecContext(ctx, insert, args...); err != nil {
			iter.Close()
			return 0, err
		}
		count++
		row = map[string]interface{}{}
	}
	if err = iter.Close(); err != nil {
		return 0, err
	}
	var targetRows int64
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+qname).Scan(&targetRows); err != nil {
		return 0, err
	}
	if targetRows != count {
		return 0, fmt.Errorf("row-count mismatch: source %d, target %d", count, targetRows)
	}
	currentChecksum, currentRows, err := sourceFingerprint(ctx, session, name)
	if err != nil {
		return 0, fmt.Errorf("re-fingerprint %s: %w", name, err)
	}
	if currentChecksum != expectedChecksum || currentRows != expectedRows || count != expectedRows {
		return 0, fmt.Errorf("source snapshot changed while copying %s", name)
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO chemdb.cassandra_migrations(table_name,checksum,rows) VALUES($1,$2,$3)`, name, expectedChecksum, count); err != nil {
		return 0, err
	}
	if err = tx.Commit(); err != nil {
		return 0, err
	}
	return count, nil
}

func canonicalValue(value any) string {
	switch v := value.(type) {
	case nil:
		return "null"
	case []byte:
		return "bytes:" + hex.EncodeToString(v)
	case []string:
		return "list:" + strings.Join(v, "\x00")
	case map[string]struct{}:
		items := make([]string, 0, len(v))
		for item := range v {
			items = append(items, item)
		}
		sort.Strings(items)
		return "set:" + strings.Join(items, "\x00")
	case time.Time:
		return "time:" + v.UTC().Format(time.RFC3339Nano)
	default:
		return fmt.Sprintf("%T:%v", value, value)
	}
}

// sourceFingerprint includes schema and every value, with rows sorted so CQL
// scan order cannot affect the manifest. It intentionally reads the source
// before copying: a changed source snapshot is rejected rather than mixed.
func sourceFingerprint(ctx context.Context, session *gocql.Session, name string) (string, int64, error) {
	cols, err := legacyColumns(ctx, session, name)
	if err != nil {
		return "", 0, err
	}
	selected := make([]string, len(cols))
	schema := make([]string, len(cols))
	for i, c := range cols {
		selected[i] = pq.QuoteIdentifier(c.name)
		schema[i] = fmt.Sprintf("%s:%s:%t:%d", c.name, c.typ, c.key, c.position)
	}
	iter := session.Query("SELECT " + strings.Join(selected, ",") + " FROM " + name).WithContext(ctx).Iter()
	rows := []string{}
	row := map[string]interface{}{}
	for iter.MapScan(row) {
		values := make([]string, len(cols))
		for i, c := range cols {
			values[i] = canonicalValue(row[c.name])
		}
		rows = append(rows, strings.Join(values, "\x1f"))
		row = map[string]interface{}{}
	}
	if err := iter.Close(); err != nil {
		return "", 0, err
	}
	sort.Strings(rows)
	h := sha256.New()
	h.Write([]byte(strings.Join(schema, "\x1e")))
	h.Write([]byte("\x1d"))
	h.Write([]byte(strings.Join(rows, "\x1e")))
	return hex.EncodeToString(h.Sum(nil)), int64(len(rows)), nil
}

func postgresArray(value any) (any, error) {
	switch v := value.(type) {
	case []string:
		return pq.Array(v), nil
	case map[string]struct{}: // gocql decodes SET<TEXT> into this form.
		items := make([]string, 0, len(v))
		for item := range v {
			items = append(items, item)
		}
		sort.Strings(items)
		return pq.Array(items), nil
	default:
		return nil, fmt.Errorf("unexpected collection value %T", value)
	}
}

// RunCassandraToPostgres copies the complete chemdb snapshot while holding a
// PostgreSQL advisory lock. It is safe to rerun only for the same registry
// snapshot and refuses conflicting partial/cutover state.
func RunCassandraToPostgres(ctx context.Context, session *gocql.Session, db *sql.DB) error {
	if err := session.Query("SELECT cluster_name FROM system.local").WithContext(ctx).Exec(); err != nil {
		return fmt.Errorf("connect Cassandra source: %w", err)
	}
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("connect PostgreSQL target: %w", err)
	}
	if _, err := db.ExecContext(ctx, `SELECT pg_advisory_lock(604260); CREATE SCHEMA IF NOT EXISTS chemdb; CREATE TABLE IF NOT EXISTS chemdb.cassandra_migrations (table_name text PRIMARY KEY, checksum text NOT NULL, rows bigint NOT NULL, completed_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	defer db.ExecContext(context.Background(), "SELECT pg_advisory_unlock(604260)")
	// Static tables use exactly the same dynamic-copy path, including their
	// primary keys and all rows. Their schemas are part of the legacy snapshot.
	registryRows := []struct {
		createdAt                          time.Time
		name, version, meta, data, species string
		ok, active                         bool
	}{}
	iter := session.Query(`SELECT created_at, name, version, table_meta, table_data, table_species, is_ok, is_active FROM chemdb.tables`).WithContext(ctx).Iter()
	var r struct {
		createdAt                          time.Time
		name, version, meta, data, species string
		ok, active                         bool
	}
	for iter.Scan(&r.createdAt, &r.name, &r.version, &r.meta, &r.data, &r.species, &r.ok, &r.active) {
		registryRows = append(registryRows, r)
	}
	if err := iter.Close(); err != nil {
		return err
	}
	names := []string{"chemdb.bibtex", "chemdb.pages", "chemdb.tables"}
	for _, x := range registryRows {
		names = append(names, x.meta, x.data, x.species)
		sources, err := discoverSourceTables(ctx, session, x.data, x.species)
		if err != nil {
			return err
		}
		if len(sources) == 0 {
			var previouslyCopied bool
			if err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM chemdb.cassandra_migrations WHERE table_name=$1)`, cassandra.SourceCatalogName(x.data)).Scan(&previouslyCopied); err != nil {
				return err
			}
			if previouslyCopied {
				return fmt.Errorf("source catalog disappeared after completed migration for %s", x.data)
			}
		}
		names = append(names, sources...)
	}
	sort.Strings(names)
	for index, name := range names {
		if index > 0 && name == names[index-1] {
			continue
		}
		checksum, sourceRows, err := sourceFingerprint(ctx, session, name)
		if err != nil {
			return fmt.Errorf("count %s: %w", name, err)
		}
		var old string
		var rows int64
		err = db.QueryRowContext(ctx, `SELECT checksum, rows FROM chemdb.cassandra_migrations WHERE table_name=$1`, name).Scan(&old, &rows)
		if err == nil {
			if old != checksum || rows != sourceRows {
				return fmt.Errorf("conflicting completed migration for %s", name)
			}
			continue
		}
		if err != sql.ErrNoRows {
			return err
		}
		copied, err := copyDynamicTable(ctx, session, db, name, checksum, sourceRows)
		if err != nil {
			return fmt.Errorf("copy %s: %w", name, err)
		}
		if copied != sourceRows {
			return fmt.Errorf("row-count changed while copying %s", name)
		}
	}
	return cassandra.NewPostgresStore(db).EnsureActivationSchema(ctx)
}

// Older Cassandra snapshots have no catalog: preserve their joined data,
// complete species and authoritative BibTeX without inventing lost originals.
func discoverSourceTables(ctx context.Context, session *gocql.Session, data, species string) ([]string, error) {
	if _, err := quotedQualified(data); err != nil {
		return nil, err
	}
	catalog := cassandra.SourceCatalogName(data)
	parts := strings.Split(catalog, ".")
	var existing string
	err := session.Query(`SELECT table_name FROM system_schema.tables WHERE keyspace_name=? AND table_name=?`, strings.ToLower(parts[0]), strings.ToLower(parts[1])).WithContext(ctx).Scan(&existing)
	if err == gocql.ErrNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	names := []string{catalog}
	iter := session.Query("SELECT virtual_name, physical_table FROM " + catalog).WithContext(ctx).Iter()
	var virtual, physical string
	for iter.Scan(&virtual, &physical) {
		if err := cassandra.ValidateSourceTable(data, species, virtual, physical); err != nil {
			iter.Close()
			return nil, err
		}
		names = append(names, physical)
	}
	if err := iter.Close(); err != nil {
		return nil, err
	}
	return names, nil
}
