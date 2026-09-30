package cassandra

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	domainsearch "admin/internal/domain/search"
	"admin/internal/pkg/metadata"
	"github.com/lib/pq"
)

// SearchEntityGroups resolves only count identities returned by this search.
// A missing legacy source catalog leaves the existing search response intact.
func (s *Store) SearchEntityGroups(ctx context.Context, timestamp time.Time, data []map[string]any) (map[string]domainsearch.EntityGroup, error) {
	if s == nil || s.db == nil || len(data) == 0 {
		return nil, nil
	}
	table, err := s.pgGetActiveTable(nil)
	if err != nil {
		return nil, err
	}
	if !table.Timestamp.Equal(timestamp) {
		return nil, fmt.Errorf("active dataset changed; retry search")
	}
	keys, err := s.EntityCountColumns(ctx, table)
	if err != nil {
		return nil, err
	}
	groups := map[string]domainsearch.EntityGroup{}
	for kind, responseKind := range map[string]string{"chemicals": "chemical", "species": "species"} {
		count := keys[responseKind]
		if count == "" {
			continue
		}
		values := map[string]bool{}
		for _, row := range data {
			if value, ok := row[count].(string); ok && configuredCountValue(value) {
				values[value] = true
			}
		}
		if len(values) == 0 {
			continue
		}
		catalog, err := s.sourceCatalog(ctx, table, kind)
		if errors.Is(err, ErrCatalogUnavailable) {
			continue
		}
		if err != nil {
			return nil, err
		}
		physical, err := pgTable(catalog.physical)
		if err != nil {
			return nil, err
		}
		primary, err := pgColumn(catalog.primary)
		if err != nil {
			return nil, err
		}
		ids := make([]string, 0, len(values))
		for value := range values {
			ids = append(ids, value)
		}
		rows, err := s.db.QueryContext(ctx, `SELECT row_to_json(source_row)::text FROM `+physical+` source_row WHERE `+primary+` = ANY($1) ORDER BY `+primary, pq.Array(ids))
		if err != nil {
			return nil, err
		}
		items, err := decodeEntityRows(rows)
		if err != nil {
			return nil, err
		}
		presentation := make([]domainsearch.ColumnMeta, len(catalog.columns))
		for i, column := range catalog.columns {
			presentation[i] = domainsearch.ColumnMeta{Column: column.Column, Name: column.Name, Type: column.Type, Description: column.Description}
		}
		groups[responseKind] = domainsearch.EntityGroup{PrimaryColumn: catalog.primary, CountColumn: count, Columns: presentation, Items: items}
	}
	latest, err := s.pgGetActiveTable(nil)
	if err != nil {
		return nil, err
	}
	if !latest.Timestamp.Equal(timestamp) {
		return nil, fmt.Errorf("active dataset changed; retry search")
	}
	return groups, nil
}

func decodeEntityRows(rows *sql.Rows) ([]map[string]any, error) {
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var item map[string]any
		if err := json.Unmarshal([]byte(raw), &item); err != nil {
			return nil, fmt.Errorf("decode source row: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

type Stereoisomer struct {
	ID               string         `json:"id"`
	Item             map[string]any `json:"item"`
	SpeciesCount     int64          `json:"species_count"`
	PublicationCount int64          `json:"publication_count"`
	HasObservations  bool           `json:"has_observations"`
}

type StereoisomerFamily struct {
	Timestamp          time.Time       `json:"timestamp"`
	PrimaryColumn      string          `json:"primary_column"`
	CountColumn        string          `json:"count_column"`
	GroupValue         string          `json:"group_value"`
	SpeciesCountColumn string          `json:"species_count_column,omitempty"`
	PublicationColumns []string        `json:"publication_columns"`
	Columns            []CatalogColumn `json:"columns"`
	Items              []Stereoisomer  `json:"items"`
}

// ChemicalStereoisomers reads one immutable dataset snapshot, including
// source-only family members whose joined observation counts are zero.
func (s *Store) ChemicalStereoisomers(ctx context.Context, id string) (*StereoisomerFamily, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	var table Table
	var raw []byte
	err = tx.QueryRowContext(ctx, `SELECT t.created_at,t.table_data,t.table_species,m.document FROM chemdb.tables t JOIN chemdb.metadata_versions m ON m.version=t.metadata_version WHERE t.is_active AND t.is_ok`).Scan(&table.Timestamp, &table.TableData, &table.TableSpecies, &raw)
	if err != nil {
		return nil, err
	}
	var document metadata.Document
	if err = json.Unmarshal(raw, &document); err != nil {
		return nil, err
	}
	catalog, err := sourceCatalogQuery(ctx, tx, &table, "chemicals")
	if err != nil {
		return nil, err
	}
	physical, err := pgTable(catalog.physical)
	if err != nil {
		return nil, err
	}
	primary, err := pgColumn(catalog.primary)
	if err != nil {
		return nil, err
	}
	var selectedRaw string
	err = tx.QueryRowContext(ctx, `SELECT row_to_json(source_row)::text FROM `+physical+` source_row WHERE `+primary+`=$1`, id).Scan(&selectedRaw)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var selected map[string]any
	if err = json.Unmarshal([]byte(selectedRaw), &selected); err != nil {
		return nil, err
	}
	count := document.EntityCountColumns()["chemical"]
	if count == "" {
		count = catalog.primary
	}
	groupValue, _ := selected[count].(string)
	if !configuredCountValue(groupValue) {
		groupValue = id
		count = catalog.primary
	}
	countSQL, err := pgColumn(count)
	if err != nil {
		return nil, err
	}
	condition := countSQL + `=$1`
	args := []any{groupValue}
	if count != catalog.primary {
		condition += ` OR ` + primary + `=ANY($2)`
		args = append(args, pq.Array([]string{groupValue, id}))
	}
	rows, err := tx.QueryContext(ctx, `SELECT row_to_json(source_row)::text FROM `+physical+` source_row WHERE `+condition+` ORDER BY `+primary, args...)
	if err != nil {
		return nil, err
	}
	sources, err := decodeEntityRows(rows)
	if err != nil {
		return nil, err
	}
	family := &StereoisomerFamily{Timestamp: table.Timestamp, PrimaryColumn: catalog.primary, CountColumn: count, GroupValue: groupValue, PublicationColumns: []string{}, Columns: catalog.columns, Items: make([]Stereoisomer, 0, len(sources))}
	ids := make([]string, 0, len(sources))
	for _, item := range sources {
		memberID, _ := item[catalog.primary].(string)
		family.Items = append(family.Items, Stereoisomer{ID: memberID, Item: item})
		ids = append(ids, memberID)
	}
	if len(ids) == 0 {
		return family, tx.Commit()
	}
	counts, err := chemicalObservationCounts(ctx, tx, table.TableData, catalog.primary, document, ids, family)
	if err != nil {
		return nil, err
	}
	for i := range family.Items {
		_, family.Items[i].HasObservations = counts[family.Items[i].ID]
		family.Items[i].SpeciesCount = counts[family.Items[i].ID][0]
		family.Items[i].PublicationCount = counts[family.Items[i].ID][1]
	}
	return family, tx.Commit()
}

func chemicalObservationCounts(ctx context.Context, tx *sql.Tx, dataTable, chemicalID string, document metadata.Document, ids []string, family *StereoisomerFamily) (map[string][2]int64, error) {
	joined, err := pgTable(dataTable)
	if err != nil {
		return nil, err
	}
	columns := map[string]bool{}
	columnRows, err := tx.QueryContext(ctx, `SELECT attname FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped`, joined)
	if err != nil {
		return nil, err
	}
	for columnRows.Next() {
		var name string
		if err := columnRows.Scan(&name); err != nil {
			return nil, errors.Join(err, columnRows.Close())
		}
		columns[name] = true
	}
	if err := columnRows.Err(); err != nil {
		return nil, errors.Join(err, columnRows.Close())
	}
	if err := columnRows.Close(); err != nil {
		return nil, err
	}
	if !columns[chemicalID] {
		return map[string][2]int64{}, nil
	}
	chemical, err := pgColumn(chemicalID)
	if err != nil {
		return nil, err
	}
	species := document.EntityCountColumns()["species"]
	speciesExpression := `NULL::text`
	if species != "" && columns[species] {
		quoted, quoteErr := pgColumn(species)
		if quoteErr != nil {
			return nil, quoteErr
		}
		speciesExpression = `j.` + quoted
		family.SpeciesCountColumn = species
	}
	refs := []string{}
	seenRefs := map[string]bool{}
	for _, sheet := range document.Sheets {
		for _, column := range sheet.Columns {
			if column.Reference && columns[column.Name] && !seenRefs[column.Name] {
				seenRefs[column.Name] = true
				quoted, quoteErr := pgColumn(column.Name)
				if quoteErr != nil {
					return nil, quoteErr
				}
				refs = append(refs, `to_jsonb(j.`+quoted+`)`)
				family.PublicationColumns = append(family.PublicationColumns, column.Name)
			}
		}
	}
	refJoin := ``
	refCount := `0`
	if len(refs) > 0 {
		refJoin = ` LEFT JOIN LATERAL jsonb_array_elements(jsonb_build_array(` + strings.Join(refs, ",") + `)) ref_cell(value) ON true LEFT JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(ref_cell.value)='array' THEN ref_cell.value ELSE jsonb_build_array(ref_cell.value) END) ref(value) ON true LEFT JOIN LATERAL unnest(string_to_array(ref.value, ',')) ref_piece(value) ON true`
		refCount = `COUNT(DISTINCT NULLIF(btrim(ref_piece.value),'')) FILTER (WHERE lower(replace(btrim(ref_piece.value),' ','')) NOT IN ('novalue','null'))`
	}
	query := `SELECT j.` + chemical + `, COUNT(DISTINCT NULLIF(btrim(` + speciesExpression + `),'')) FILTER (WHERE lower(replace(btrim(` + speciesExpression + `),' ','')) <> 'novalue'), ` + refCount + ` FROM ` + joined + ` j` + refJoin + ` WHERE j.` + chemical + ` = ANY($1) GROUP BY j.` + chemical
	rows, err := tx.QueryContext(ctx, query, pq.Array(ids))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := map[string][2]int64{}
	for rows.Next() {
		var id string
		var speciesCount, publicationCount int64
		if err := rows.Scan(&id, &speciesCount, &publicationCount); err != nil {
			return nil, err
		}
		counts[id] = [2]int64{speciesCount, publicationCount}
	}
	return counts, rows.Err()
}

func configuredCountValue(value string) bool {
	trimmed := strings.TrimSpace(value)
	return trimmed != "" && !strings.EqualFold(strings.ReplaceAll(trimmed, " ", ""), "NoValue")
}
