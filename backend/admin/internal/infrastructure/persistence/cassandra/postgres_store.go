package cassandra

// PostgreSQL implementation of the application data store.  Dynamic workbook
// names are still allowed, but are validated and quoted; all user values are
// passed as query arguments.  This is deliberately separate from auth-master's
// database: PG_* names the application-data database only.

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/lib/pq"

	"admin/internal/presentation/http/response"
)

func pgTable(name string) (string, error) {
	parts := strings.Split(name, ".")
	if len(parts) != 2 {
		return "", fmt.Errorf("unsafe PostgreSQL table identifier %q", name)
	}
	for _, p := range parts {
		if err := ValidateIdentifier(p); err != nil {
			return "", err
		}
	}
	return pq.QuoteIdentifier(parts[0]) + "." + pq.QuoteIdentifier(parts[1]), nil
}
func pgColumn(name string) (string, error) {
	if err := ValidateIdentifier(name); err != nil {
		return "", err
	}
	return pq.QuoteIdentifier(name), nil
}

func (s *Store) ensurePostgresSchema(ctx context.Context) error {
	if s.db == nil {
		return ErrNotConfigured
	}
	_, err := s.db.ExecContext(ctx, `CREATE SCHEMA IF NOT EXISTS chemdb;
CREATE TABLE IF NOT EXISTS chemdb.tables (created_at timestamptz PRIMARY KEY, name text NOT NULL, version text NOT NULL, table_meta text NOT NULL, table_data text NOT NULL, table_species text NOT NULL, is_ok boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT false);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_chemdb_table ON chemdb.tables ((is_active)) WHERE is_active;
CREATE TABLE IF NOT EXISTS chemdb.bibtex (article_id text PRIMARY KEY, bibtex_text text NOT NULL);
CREATE TABLE IF NOT EXISTS chemdb.pages (name text PRIMARY KEY, url text NOT NULL);`)
	return err
}
func (s *Store) pgGetArticle(id string) (string, error) {
	var x string
	err := s.db.QueryRow(`SELECT bibtex_text FROM chemdb.bibtex WHERE article_id=$1`, id).Scan(&x)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return x, err
}
func (s *Store) pgBatchInsertBibtex(rows [][]any) error {
	tx, e := s.db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	for _, r := range rows {
		if len(r) != 2 {
			return fmt.Errorf("bibtex row requires id and text")
		}
		if _, e = tx.Exec(`INSERT INTO chemdb.bibtex(article_id,bibtex_text) VALUES($1,$2) ON CONFLICT(article_id) DO UPDATE SET bibtex_text=EXCLUDED.bibtex_text`, r...); e != nil {
			return e
		}
	}
	return tx.Commit()
}
func (s *Store) pgGetAllTables() ([]*Table, error) {
	rows, e := s.db.Query(`SELECT created_at,name,version,table_meta,table_data,table_species,is_ok,is_active FROM chemdb.tables ORDER BY created_at DESC`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []*Table{}
	for rows.Next() {
		t := new(Table)
		if e = rows.Scan(&t.Timestamp, &t.Name, &t.Version, &t.TableMeta, &t.TableData, &t.TableSpecies, &t.IsOk, &t.IsActive); e != nil {
			return nil, e
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
func (s *Store) pgGetActiveTable(_ *fiber.Ctx) (*Table, error) {
	t := new(Table)
	e := s.db.QueryRow(`SELECT created_at,name,version,table_meta,table_data,table_species,is_ok,is_active FROM chemdb.tables WHERE is_active AND is_ok`).Scan(&t.Timestamp, &t.Name, &t.Version, &t.TableMeta, &t.TableData, &t.TableSpecies, &t.IsOk, &t.IsActive)
	if e == sql.ErrNoRows {
		return nil, &response.UserError{E: fmt.Errorf("no active table found")}
	}
	return t, e
}
func (s *Store) pgActivateTable(timestamp time.Time) error {
	tx, e := s.db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	// Serialize active-table changes and deletion before taking individual row
	// locks, so competing activations cannot deadlock or violate the unique index.
	if _, e = tx.Exec(`SELECT pg_advisory_xact_lock(684321090)`); e != nil {
		return e
	}
	var ok bool
	if e = tx.QueryRow(`SELECT is_ok FROM chemdb.tables WHERE created_at=$1 FOR UPDATE`, timestamp).Scan(&ok); e != nil || !ok {
		if e == nil || e == sql.ErrNoRows {
			e = &response.UserError{E: fmt.Errorf("table does not exist or is not ready")}
		}
		return e
	}
	if _, e = tx.Exec(`UPDATE chemdb.tables SET is_active=false WHERE is_active`); e != nil {
		return e
	}
	if _, e = tx.Exec(`UPDATE chemdb.tables SET is_active=true WHERE created_at=$1`, timestamp); e != nil {
		return e
	}
	return tx.Commit()
}
func (s *Store) pgDeleteTable(c *fiber.Ctx, timestamp time.Time) error {
	if timestamp.After(time.Now().Add(-5 * time.Minute)) {
		return nil
	}
	tx, e := s.db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.Exec(`SELECT pg_advisory_xact_lock(684321090)`); e != nil {
		return e
	}
	t := new(Table)
	e = tx.QueryRow(`SELECT created_at,name,version,table_meta,table_data,table_species,is_ok,is_active FROM chemdb.tables WHERE created_at=$1 FOR UPDATE`, timestamp).Scan(&t.Timestamp, &t.Name, &t.Version, &t.TableMeta, &t.TableData, &t.TableSpecies, &t.IsOk, &t.IsActive)
	if e != nil {
		return e
	}
	if t.IsActive {
		return &response.UserError{E: fmt.Errorf("cannot delete the active table")}
	}
	names := []string{t.TableMeta, t.TableData, t.TableSpecies}
	catalog := SourceCatalogName(t.TableData)
	quotedCatalog, e := pgTable(catalog)
	if e != nil {
		return e
	}
	var hasCatalog bool
	if e = tx.QueryRow(`SELECT to_regclass($1) IS NOT NULL`, quotedCatalog).Scan(&hasCatalog); e != nil {
		return e
	}
	if hasCatalog {
		q, err := pgTable(catalog)
		if err != nil {
			return err
		}
		rows, err := tx.Query("SELECT virtual_name, physical_table FROM " + q)
		if err != nil {
			return err
		}
		for rows.Next() {
			var virtual, physical string
			if err = rows.Scan(&virtual, &physical); err == nil {
				err = ValidateSourceTable(t.TableData, t.TableSpecies, virtual, physical)
			}
			if err != nil {
				rows.Close()
				return err
			}
			if physical != t.TableSpecies {
				names = append(names, physical)
			}
		}
		if err = rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		names = append(names, catalog)
	}
	for _, n := range names {
		q, e := pgTable(n)
		if e != nil {
			return e
		}
		if _, e = tx.Exec("DROP TABLE IF EXISTS " + q); e != nil {
			return e
		}
	}
	if _, e = tx.Exec(`DELETE FROM chemdb.tables WHERE created_at=$1`, timestamp); e != nil {
		return e
	}
	return tx.Commit()
}
func (s *Store) pgDeleteAllBadTables(c *fiber.Ctx) error {
	ts, e := s.db.Query(`SELECT created_at FROM chemdb.tables WHERE NOT is_ok`)
	if e != nil {
		return e
	}
	defer ts.Close()
	for ts.Next() {
		var t time.Time
		if e = ts.Scan(&t); e != nil {
			return e
		}
		if e = s.pgDeleteTable(c, t); e != nil {
			return e
		}
	}
	return ts.Err()
}
func (s *Store) pgGetColumnMeta(_ *fiber.Ctx, t *Table) ([]*ColumnMeta, error) {
	n, e := pgTable(t.TableMeta)
	if e != nil {
		return nil, e
	}
	rows, e := s.db.Query(`SELECT "column", type, description, show_name FROM ` + n)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []*ColumnMeta{}
	for rows.Next() {
		x := new(ColumnMeta)
		if e = rows.Scan(&x.Column, &x.Type, &x.Description, &x.Name); e != nil {
			return nil, e
		}
		if x.Name == "" {
			x.Name = x.Column
		}
		out = append(out, x)
	}
	return out, rows.Err()
}
func (s *Store) pgGetPrefix(table, column, prefix string) ([]string, error) {
	n, e := pgTable(table)
	if e != nil {
		return nil, e
	}
	col, e := pgColumn(column)
	if e != nil {
		return nil, e
	}
	rows, e := s.db.Query(`SELECT DISTINCT `+col+`::text FROM `+n+` WHERE `+col+`::text ILIKE $1 ORDER BY 1 LIMIT 50`, prefix+"%")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var x string
		if e = rows.Scan(&x); e != nil {
			return nil, e
		}
		out = append(out, x)
	}
	return out, rows.Err()
}
func (s *Store) pgGetColumn(table, column string) ([]string, error) {
	n, e := pgTable(table)
	if e != nil {
		return nil, e
	}
	col, e := pgColumn(column)
	if e != nil {
		return nil, e
	}
	rows, e := s.db.Query(`SELECT ` + col + `::text FROM ` + n)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var x string
		if e = rows.Scan(&x); e != nil {
			return nil, e
		}
		out = append(out, x)
	}
	return out, rows.Err()
}
func (s *Store) pgGetPageKey(name string) (string, error) {
	var x string
	e := s.db.QueryRow(`SELECT url FROM chemdb.pages WHERE name=$1`, name).Scan(&x)
	if e == sql.ErrNoRows {
		return "", nil
	}
	return x, e
}
func (s *Store) pgSetPageKey(name, key string) error {
	_, e := s.db.Exec(`INSERT INTO chemdb.pages(name,url) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET url=EXCLUDED.url`, name, key)
	return e
}

var pgCondition = regexp.MustCompile(`^([A-Za-z][A-Za-z0-9_]*)\s*(=|!=|<=|>=|<|>|LIKE|CONTAINS)\s*'((?:''|[^'])*)'`)
var pgConjunction = regexp.MustCompile(`^\s+AND\s+`)

func pgWhere(raw string) (string, []any, error) {
	raw = strings.TrimSpace(raw)
	clauses := []string{}
	args := []any{}
	for {
		m := pgCondition.FindStringSubmatch(raw)
		if m == nil {
			return "", nil, fmt.Errorf("unsupported search expression")
		}
		col, e := pgColumn(m[1])
		if e != nil {
			return "", nil, e
		}
		v := strings.ReplaceAll(m[3], "''", "'")
		if m[2] == "CONTAINS" {
			clauses = append(clauses, col+" @> ARRAY[$"+fmt.Sprint(len(args)+1)+"]::text[]")
		} else if m[2] == "LIKE" {
			clauses = append(clauses, col+" ILIKE $"+fmt.Sprint(len(args)+1))
		} else {
			clauses = append(clauses, col+" "+m[2]+" $"+fmt.Sprint(len(args)+1))
		}
		args = append(args, v)
		raw = raw[len(m[0]):]
		if raw == "" {
			break
		}
		separator := pgConjunction.FindString(raw)
		if separator == "" {
			return "", nil, fmt.Errorf("unsupported search expression")
		}
		raw = raw[len(separator):]
	}
	return strings.Join(clauses, " AND "), args, nil
}
func (s *Store) pgGetColumnWhere(table, selectClause, where string) ([]map[string]any, error) {
	n, e := pgTable(table)
	if e != nil {
		return nil, e
	}
	cols := strings.Split(selectClause, ",")
	quoted := make([]string, len(cols))
	for i, x := range cols {
		quoted[i], e = pgColumn(strings.TrimSpace(x))
		if e != nil {
			return nil, e
		}
	}
	w, args, e := pgWhere(where)
	if e != nil {
		return nil, e
	}
	rows, e := s.db.Query(`SELECT `+strings.Join(quoted, ",")+` FROM `+n+` WHERE `+w, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	names, e := rows.Columns()
	if e != nil {
		return nil, e
	}
	columnTypes, e := rows.ColumnTypes()
	if e != nil {
		return nil, e
	}
	out := []map[string]any{}
	for rows.Next() {
		vals := make([]any, len(names))
		ptrs := make([]any, len(vals))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if e = rows.Scan(ptrs...); e != nil {
			return nil, e
		}
		r := map[string]any{}
		for i, v := range vals {
			if columnTypes[i].DatabaseTypeName() == "_TEXT" {
				var items pq.StringArray
				if e = items.Scan(v); e != nil {
					return nil, fmt.Errorf("decode set column %q: %w", names[i], e)
				}
				if items == nil {
					items = pq.StringArray{}
				}
				r[names[i]] = []string(items)
				continue
			}
			if b, ok := v.([]byte); ok {
				r[names[i]] = string(b)
			} else {
				r[names[i]] = v
			}
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func pgColumnType(cql string) (string, error) {
	switch strings.ToUpper(cql) {
	case "TEXT":
		return "text", nil
	case "UUID":
		return "uuid", nil
	case "SET<TEXT>":
		return "text[]", nil
	default:
		return "", fmt.Errorf("unsupported column type %q", cql)
	}
}
func postgresSetArray(value any) (any, error) {
	switch v := value.(type) {
	case []string:
		return pq.Array(v), nil
	case map[string]struct{}:
		items := make([]string, 0, len(v))
		for item := range v {
			items = append(items, item)
		}
		sort.Strings(items)
		return pq.Array(items), nil
	default:
		return nil, fmt.Errorf("unexpected SET<TEXT> value %T", value)
	}
}
func (s *Store) pgCreateAndBatchInsert(table string, defs, keys []string, data [][]any) error {
	n, e := pgTable(table)
	if e != nil {
		return e
	}
	cols, types := make([]string, len(defs)), make([]string, len(defs))
	for i, d := range defs {
		f := strings.Fields(d)
		if len(f) != 2 {
			return fmt.Errorf("unsafe column definition %q", d)
		}
		cols[i], e = pgColumn(f[0])
		if e != nil {
			return e
		}
		types[i], e = pgColumnType(f[1])
		if e != nil {
			return e
		}
	}
	pks := make([]string, len(keys))
	for i, k := range keys {
		pks[i], e = pgColumn(k)
		if e != nil {
			return e
		}
	}
	definitions := make([]string, len(cols))
	for i := range cols {
		definitions[i] = cols[i] + " " + types[i]
	}
	if _, e = s.db.Exec("CREATE TABLE " + n + " (" + strings.Join(definitions, ",") + ", PRIMARY KEY (" + strings.Join(pks, ",") + "))"); e != nil {
		return e
	}
	tx, e := s.db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	ph := make([]string, len(cols))
	for i := range ph {
		ph[i] = fmt.Sprintf("$%d", i+1)
	}
	q := "INSERT INTO " + n + " (" + strings.Join(cols, ",") + ") VALUES (" + strings.Join(ph, ",") + ")"
	for _, r := range data {
		if len(r) != len(cols) {
			return fmt.Errorf("different length of data rows")
		}
		values := append([]any(nil), r...)
		for i, definition := range defs {
			if strings.EqualFold(strings.Fields(definition)[1], "SET<TEXT>") {
				values[i], e = postgresSetArray(values[i])
				if e != nil {
					return fmt.Errorf("SET<TEXT> column %q: %w", strings.Fields(definition)[0], e)
				}
			}
		}
		if _, e = tx.Exec(q, values...); e != nil {
			return e
		}
	}
	return tx.Commit()
}
func (s *Store) pgReserveTable(t *Table) (bool, error) {
	r, e := s.db.Exec(`INSERT INTO chemdb.tables(created_at,name,version,table_meta,table_data,table_species,is_active,is_ok) VALUES($1,$2,$3,$4,$5,$6,false,false) ON CONFLICT(created_at) DO NOTHING`, t.Timestamp, t.Name, t.Version, t.TableMeta, t.TableData, t.TableSpecies)
	if e != nil {
		return false, e
	}
	n, e := r.RowsAffected()
	return n == 1, e
}
func (s *Store) pgSetTableOk(t *Table) error {
	_, e := s.db.Exec(`UPDATE chemdb.tables SET is_ok=true WHERE created_at=$1`, t.Timestamp)
	return e
}
func (s *Store) pgArticleIDs() (map[string]string, error) {
	rows, e := s.db.Query(`SELECT article_id FROM chemdb.bibtex`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	o := map[string]string{}
	for rows.Next() {
		var x string
		if e = rows.Scan(&x); e != nil {
			return nil, e
		}
		o[x] = ""
	}
	return o, rows.Err()
}
func (s *Store) pgCreateSearchIndex(table, column string) error {
	n, e := pgTable(table)
	if e != nil {
		return e
	}
	c, e := pgColumn(column)
	if e != nil {
		return e
	}
	var array bool
	e = s.db.QueryRow(`SELECT atttypid = 'text[]'::regtype FROM pg_attribute WHERE attrelid = $1::regclass AND attname = $2 AND NOT attisdropped`, n, column).Scan(&array)
	if e != nil {
		return e
	}
	// Hash the complete table/column identity to avoid identifier truncation and
	// collisions across long workbook names. The operator class for array GIN
	// supports the @> predicate used by CONTAINS.
	index := fmt.Sprintf("idx_%x", sha256.Sum256([]byte(table+"."+column)))[:60]
	definition := ` (lower(` + c + `::text))`
	if array {
		definition = ` USING gin (` + c + `)`
	}
	_, e = s.db.Exec(`CREATE INDEX IF NOT EXISTS ` + pq.QuoteIdentifier(index) + ` ON ` + n + definition)
	return e
}

// keep sort imported in older toolchains that build with limited SQL test tags.
var _ = sort.Strings
