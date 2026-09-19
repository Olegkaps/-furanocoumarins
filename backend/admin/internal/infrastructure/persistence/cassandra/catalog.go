package cassandra

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"admin/internal/presentation/http/response"
)

var ErrCatalogUnavailable = errors.New("source catalog is unavailable for the active dataset; reimport the workbook to recover unjoined rows")

type CatalogColumn struct {
	Column      string `json:"column"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
}

type CatalogPage struct {
	Kind           string           `json:"kind"`
	PageSize       int              `json:"page_size"`
	PrimaryColumn  string           `json:"primary_column"`
	PreviousCursor string           `json:"previous_cursor,omitempty"`
	NextCursor     string           `json:"next_cursor,omitempty"`
	Columns        []CatalogColumn  `json:"columns"`
	Items          []map[string]any `json:"items"`
}

// CatalogCount is deliberately separate from CatalogPage: cursor-page reads
// remain a primary-key seek and never pay for a table-wide aggregate.
type CatalogCount struct {
	Kind      string `json:"kind"`
	PageSize  int    `json:"page_size"`
	Total     int64  `json:"total"`
	PageCount int64  `json:"page_count"`
}

// CatalogRecord is one preserved source row used as a public entity-page
// fallback when that chemical or species is not present in the joined table.
type CatalogRecord struct {
	Kind          string          `json:"kind"`
	PrimaryColumn string          `json:"primary_column"`
	Columns       []CatalogColumn `json:"columns"`
	Item          map[string]any  `json:"item"`
}

type sourceCatalog struct {
	physical string
	primary  string
	columns  []CatalogColumn
}

func (s *Store) GetCatalogPage(ctx context.Context, kind, after, before string, pageSize int) (*CatalogPage, error) {
	var err error
	after, err = decodeCatalogCursor(after)
	if err != nil {
		return nil, err
	}
	before, err = decodeCatalogCursor(before)
	if err != nil {
		return nil, err
	}
	if s == nil || s.db == nil {
		return nil, ErrCatalogUnavailable
	}
	if kind == "publications" {
		return s.pgPublicationCatalog(ctx, after, before, pageSize)
	}
	if kind != "chemicals" && kind != "species" {
		return nil, &response.UserError{E: fmt.Errorf("unknown catalog kind %q", kind)}
	}
	table, err := s.pgGetActiveTable(nil)
	if err != nil {
		return nil, err
	}
	return s.pgSourceCatalog(ctx, table, kind, after, before, pageSize)
}

// GetCatalogCount returns catalog-wide navigation metadata. Callers should
// request it independently from cursor pages because COUNT(*) is not a seek.
func (s *Store) GetCatalogCount(ctx context.Context, kind string, pageSize int) (*CatalogCount, error) {
	if s == nil || s.db == nil {
		return nil, ErrCatalogUnavailable
	}
	if kind == "publications" {
		return s.pgCatalogCount(ctx, kind, "chemdb.bibtex", pageSize)
	}
	if kind != "chemicals" && kind != "species" {
		return nil, &response.UserError{E: fmt.Errorf("unknown catalog kind %q", kind)}
	}
	table, err := s.pgGetActiveTable(nil)
	if err != nil {
		return nil, err
	}
	catalog, err := s.sourceCatalog(ctx, table, kind)
	if err != nil {
		return nil, err
	}
	tableName, err := pgTable(catalog.physical)
	if err != nil {
		return nil, err
	}
	return s.pgCatalogCount(ctx, kind, tableName, pageSize)
}

func (s *Store) pgCatalogCount(ctx context.Context, kind, tableName string, pageSize int) (*CatalogCount, error) {
	var total int64
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM `+tableName).Scan(&total); err != nil {
		return nil, err
	}
	return &CatalogCount{Kind: kind, PageSize: pageSize, Total: total, PageCount: (total + int64(pageSize) - 1) / int64(pageSize)}, nil
}

func (s *Store) GetCatalogRecord(ctx context.Context, kind, column, value string) (*CatalogRecord, error) {
	if s == nil || s.db == nil {
		return nil, ErrCatalogUnavailable
	}
	if kind != "chemicals" && kind != "species" {
		return nil, &response.UserError{E: fmt.Errorf("catalog record kind must be chemicals or species")}
	}
	table, err := s.pgGetActiveTable(nil)
	if err != nil {
		return nil, err
	}
	return s.pgSourceCatalogRecord(ctx, table, kind, column, value)
}

// GetCatalogRecordByID resolves the immutable source-table primary key.  Public
// entity URLs use this rather than a mutable display name or SMILES value.
func (s *Store) GetCatalogRecordByID(ctx context.Context, kind, id string) (*CatalogRecord, error) {
	if s == nil || s.db == nil {
		return nil, ErrCatalogUnavailable
	}
	if kind != "chemicals" && kind != "species" {
		return nil, &response.UserError{E: fmt.Errorf("catalog record kind must be chemicals or species")}
	}
	table, err := s.pgGetActiveTable(nil)
	if err != nil {
		return nil, err
	}
	catalog, err := s.sourceCatalog(ctx, table, kind)
	if err != nil {
		return nil, err
	}
	return s.pgSourceCatalogRecord(ctx, table, kind, catalog.primary, id)
}

func (s *Store) pgSourceCatalog(ctx context.Context, table *Table, kind, after, before string, pageSize int) (*CatalogPage, error) {
	catalog, err := s.sourceCatalog(ctx, table, kind)
	if err != nil {
		return nil, err
	}
	orderColumn, err := pgColumn(catalog.primary)
	if err != nil {
		return nil, err
	}
	physicalTable, err := pgTable(catalog.physical)
	if err != nil {
		return nil, err
	}
	rows, err := catalogRows(ctx, s.db, physicalTable, orderColumn, after, before, pageSize)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0, pageSize)
	for rows.Next() {
		var raw string
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		item := map[string]any{}
		if err = json.Unmarshal([]byte(raw), &item); err != nil {
			return nil, fmt.Errorf("decode source row: %w", err)
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	page := catalogPage(kind, pageSize, after, before, catalog.primary, items)
	page.PrimaryColumn = catalog.primary
	page.Columns = catalog.columns
	return page, nil
}

func (s *Store) pgSourceCatalogRecord(ctx context.Context, table *Table, kind, column, value string) (*CatalogRecord, error) {
	catalog, err := s.sourceCatalog(ctx, table, kind)
	if err != nil {
		return nil, err
	}
	if !containsCatalogColumn(catalog.columns, column) {
		return nil, &response.UserError{E: fmt.Errorf("column %q is not available in the %s source catalog", column, kind)}
	}
	physicalTable, err := pgTable(catalog.physical)
	if err != nil {
		return nil, err
	}
	quotedColumn, err := pgColumn(column)
	if err != nil {
		return nil, err
	}
	var raw string
	err = s.db.QueryRowContext(ctx, `SELECT row_to_json(source_row)::text FROM (SELECT * FROM `+physicalTable+` WHERE `+quotedColumn+`=$1 LIMIT 1) source_row`, value).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	item := map[string]any{}
	if err = json.Unmarshal([]byte(raw), &item); err != nil {
		return nil, fmt.Errorf("decode source row: %w", err)
	}
	return &CatalogRecord{Kind: kind, PrimaryColumn: catalog.primary, Columns: catalog.columns, Item: item}, nil
}

func (s *Store) sourceCatalog(ctx context.Context, table *Table, kind string) (*sourceCatalog, error) {
	catalogName := SourceCatalogName(table.TableData)
	catalogTable, err := pgTable(catalogName)
	if err != nil {
		return nil, err
	}
	var exists bool
	if err = s.db.QueryRowContext(ctx, `SELECT to_regclass($1) IS NOT NULL`, catalogTable).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrCatalogUnavailable
	}
	virtual := map[string]string{"chemicals": "structures", "species": "classification"}[kind]
	var physical, entityKind, primary, columnsJSON string
	err = s.db.QueryRowContext(ctx, `SELECT physical_table,entity_kind,primary_column,columns_json FROM `+catalogTable+` WHERE virtual_name=$1`, virtual).
		Scan(&physical, &entityKind, &primary, &columnsJSON)
	if err == sql.ErrNoRows {
		return nil, ErrCatalogUnavailable
	}
	if err != nil {
		return nil, err
	}
	if entityKind != kind {
		return nil, fmt.Errorf("source catalog kind mismatch for %q", virtual)
	}
	if err = ValidateSourceTable(table.TableData, table.TableSpecies, virtual, physical); err != nil {
		return nil, err
	}
	columns, err := parseCatalogColumns(columnsJSON)
	if err != nil {
		return nil, err
	}
	if !containsCatalogColumn(columns, primary) {
		return nil, fmt.Errorf("source catalog primary column %q is unavailable", primary)
	}
	return &sourceCatalog{physical: physical, primary: primary, columns: columns}, nil
}

func containsCatalogColumn(columns []CatalogColumn, name string) bool {
	for _, column := range columns {
		if column.Column == name {
			return true
		}
	}
	return false
}

func (s *Store) pgPublicationCatalog(ctx context.Context, after, before string, pageSize int) (*CatalogPage, error) {
	rows, err := catalogRows(ctx, s.db, `chemdb.bibtex`, `article_id`, after, before, pageSize)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0, pageSize)
	for rows.Next() {
		var raw string
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		item := map[string]any{}
		if err = json.Unmarshal([]byte(raw), &item); err != nil {
			return nil, fmt.Errorf("decode publication row: %w", err)
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	page := catalogPage("publications", pageSize, after, before, "article_id", items)
	page.PrimaryColumn = "article_id"
	page.Columns = []CatalogColumn{{Column: "article_id", Name: "Reference"}, {Column: "bibtex_text", Name: "Publication", Type: "bibtex"}}
	return page, nil
}

// catalogRows uses the source table's primary key (or bibtex article_id) as a
// B-tree-backed seek cursor. It intentionally avoids OFFSET and count scans.
func catalogRows(ctx context.Context, db *sql.DB, table, column, after, before string, pageSize int) (*sql.Rows, error) {
	if after != "" && before != "" {
		return nil, &response.UserError{E: fmt.Errorf("cursor and before cannot be used together")}
	}
	limit := pageSize + 1
	if before != "" {
		return db.QueryContext(ctx, `SELECT row_to_json(source_row)::text FROM (SELECT * FROM `+table+` WHERE `+column+` < $1 ORDER BY `+column+` DESC LIMIT $2) source_row ORDER BY `+column+` ASC`, before, limit)
	}
	if after != "" {
		return db.QueryContext(ctx, `SELECT row_to_json(source_row)::text FROM (SELECT * FROM `+table+` WHERE `+column+` > $1 ORDER BY `+column+` LIMIT $2) source_row`, after, limit)
	}
	return db.QueryContext(ctx, `SELECT row_to_json(source_row)::text FROM (SELECT * FROM `+table+` ORDER BY `+column+` LIMIT $1) source_row`, limit)
}

func catalogPage(kind string, pageSize int, after, before, primary string, items []map[string]any) *CatalogPage {
	page := &CatalogPage{Kind: kind, PageSize: pageSize, Items: items}
	hasMore := len(items) > pageSize
	if hasMore {
		if before != "" {
			items = items[1:]
		} else {
			items = items[:pageSize]
		}
		page.Items = items
	}
	if len(items) == 0 {
		return page
	}
	if after != "" || (before != "" && hasMore) {
		page.PreviousCursor = catalogCursor(items[0], primary)
	}
	if hasMore || before != "" {
		page.NextCursor = catalogCursor(page.Items[len(page.Items)-1], primary)
	}
	return page
}

func catalogCursor(item map[string]any, primary string) string {
	value, _ := item[primary].(string)
	return base64.RawURLEncoding.EncodeToString([]byte(value))
}

func decodeCatalogCursor(cursor string) (string, error) {
	if cursor == "" {
		return "", nil
	}
	value, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil || len(value) == 0 {
		return "", &response.UserError{E: fmt.Errorf("invalid catalog cursor")}
	}
	return string(value), nil
}

func parseCatalogColumns(raw string) ([]CatalogColumn, error) {
	var definitions [][]string
	if err := json.Unmarshal([]byte(raw), &definitions); err != nil {
		return nil, fmt.Errorf("decode source columns: %w", err)
	}
	columns := make([]CatalogColumn, 0, len(definitions))
	for _, definition := range definitions {
		if len(definition) < 3 {
			return nil, fmt.Errorf("invalid source column definition")
		}
		column := CatalogColumn{Column: definition[1], Name: definition[1], Type: definition[2]}
		if len(definition) > 3 {
			column.Description = definition[3]
		}
		if len(definition) > 4 && definition[4] != "" {
			column.Name = definition[4]
		}
		columns = append(columns, column)
	}
	return columns, nil
}
