package cassandra

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"admin/internal/pkg/metadata"
)

// TaxonLink is a stable taxonomic page identity.  SourceColumn makes it clear
// when a child was found below an empty intermediate rank.
type TaxonLink struct {
	Rank         int    `json:"rank"`
	Name         string `json:"name"`
	SourceColumn string `json:"source_column,omitempty"`
}

type Taxon struct {
	TaxonLink
	Title       string      `json:"title"`
	QueryColumn string      `json:"query_column,omitempty"`
	Parent      *TaxonLink  `json:"parent,omitempty"`
	Children    []TaxonLink `json:"children"`
}

type taxonomyColumn struct {
	rank, index int
	name, label string
}

// Taxonomy reads classification directly from the active dataset's preserved
// source sheet.  The document is pinned to that dataset rather than using the
// latest editable metadata definition.
func (s *Store) Taxonomy(ctx context.Context, rank int, name string) (*Taxon, error) {
	if s == nil || s.db == nil {
		return nil, ErrNotConfigured
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("taxon name is required")
	}
	var tableName string
	var raw json.RawMessage
	err := s.db.QueryRowContext(ctx, `SELECT t.table_species,m.document FROM chemdb.tables t JOIN chemdb.metadata_versions m ON m.version=t.metadata_version WHERE t.is_active AND t.is_ok`).Scan(&tableName, &raw)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("no active table found")
	}
	if err != nil {
		return nil, err
	}
	var document metadata.Document
	if err := json.Unmarshal(raw, &document); err != nil {
		return nil, fmt.Errorf("decode active taxonomy metadata: %w", err)
	}
	columns := taxonomyColumns(document)
	if len(columns) == 0 {
		return nil, fmt.Errorf("active dataset has no original classification columns")
	}
	requested := -1
	quoted := make([]string, len(columns))
	for i, column := range columns {
		var quoteErr error
		quoted[i], quoteErr = pgColumn(column.name)
		if quoteErr != nil {
			return nil, quoteErr
		}
		if column.rank == rank {
			requested = i
		}
	}
	if requested < 0 {
		return nil, fmt.Errorf("classification rank %d is unavailable", rank)
	}
	physical, err := pgTable(tableName)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+strings.Join(quoted, ",")+` FROM `+physical)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := [][]string{}
	for rows.Next() {
		cells := make([]sql.NullString, len(columns))
		pointers := make([]any, len(cells))
		for i := range cells {
			pointers[i] = &cells[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		row := make([]string, len(cells))
		for i, cell := range cells {
			row[i] = strings.TrimSpace(cell.String)
		}
		if row[requested] == name {
			values = append(values, row)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(values) == 0 {
		return nil, nil
	}
	return buildTaxon(columns, requested, name, values), nil
}

func taxonomyColumns(document metadata.Document) []taxonomyColumn {
	columns := []taxonomyColumn{}
	for _, sheet := range document.Sheets {
		for _, column := range sheet.Columns {
			// Classification sheets infer the species domain, so persisted valid
			// metadata need not redundantly carry Domain: "species" on every
			// column. The source table is the classification sheet itself.
			if !strings.HasPrefix(sheet.Name, "classification") || column.Classification == nil || effectiveTaxonomyTag(column.Classification.Tag) != "original" {
				continue
			}
			label := column.Label
			if label == "" {
				label = column.Name
			}
			columns = append(columns, taxonomyColumn{rank: column.Classification.Level, name: column.Name, label: label})
		}
	}
	sort.Slice(columns, func(i, j int) bool { return columns[i].rank < columns[j].rank })
	for i := range columns {
		columns[i].index = i
	}
	return columns
}

func effectiveTaxonomyTag(tag string) string {
	switch tag {
	case "", "default", "original":
		return "original"
	default:
		return tag
	}
}

func buildTaxon(columns []taxonomyColumn, requested int, name string, rows [][]string) *Taxon {
	result := &Taxon{TaxonLink: TaxonLink{Rank: columns[requested].rank, Name: name}, Title: name, QueryColumn: columns[requested].name, Children: []TaxonLink{}}
	if columns[requested].rank == 0 {
		if genus := firstRankValue(columns, rows, 1); genus != "" && !strings.EqualFold(genus, name) {
			result.Title = genus + " " + name
		}
	}
	for i := requested + 1; i < len(columns); i++ {
		if parent := firstValue(rows, i); parent != "" {
			result.Parent = &TaxonLink{Rank: columns[i].rank, Name: parent, SourceColumn: columns[i].label}
			break
		}
	}
	seen := map[string]bool{}
	for _, row := range rows {
		for i := requested - 1; i >= 0; i-- {
			child := row[i]
			if child == "" {
				continue
			}
			key := fmt.Sprintf("%d\x00%s", columns[i].rank, child)
			if !seen[key] {
				seen[key] = true
				result.Children = append(result.Children, TaxonLink{Rank: columns[i].rank, Name: child, SourceColumn: columns[i].label})
			}
			break
		}
	}
	sort.Slice(result.Children, func(i, j int) bool {
		if result.Children[i].Rank != result.Children[j].Rank {
			return result.Children[i].Rank > result.Children[j].Rank
		}
		return result.Children[i].Name < result.Children[j].Name
	})
	return result
}

func firstValue(rows [][]string, index int) string {
	values := []string{}
	for _, row := range rows {
		if row[index] != "" {
			values = append(values, row[index])
		}
	}
	sort.Strings(values)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func firstRankValue(columns []taxonomyColumn, rows [][]string, rank int) string {
	for index, column := range columns {
		if column.rank == rank {
			return firstValue(rows, index)
		}
	}
	return ""
}
