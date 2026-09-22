package cassandra

import (
	"admin/internal/chemistry"
	"admin/internal/pkg/metadata"
	"admin/internal/pkg/searchquery"
	"context"
	"encoding/json"
	"fmt"
	"github.com/gofiber/fiber/v2"
	"strings"
	"time"

	domainsearch "admin/internal/domain/search"
)

// SearchReader loads metadata and search rows from Cassandra.
type SearchReader struct {
	store *Store
}

func NewSearchReader(store *Store) *SearchReader {
	return &SearchReader{store: store}
}

func (r *SearchReader) ActiveTableVersion(c *fiber.Ctx) (domainsearch.TableVersion, error) {
	table, err := r.store.GetActiveTable(c)
	if err != nil {
		return domainsearch.TableVersion{}, err
	}
	return tableVersion(table), nil
}

func (r *SearchReader) FetchMetadata(c *fiber.Ctx) (*domainsearch.MetadataResponse, error) {
	activeTable, err := r.store.GetActiveTable(c)
	if err != nil {
		return nil, err
	}

	columns, err := r.store.GetColumnMeta(c, activeTable)
	if err != nil {
		return nil, err
	}

	ctx := context.Background()
	if c != nil {
		ctx = c.UserContext()
	}
	countKeys, err := r.store.EntityCountColumns(ctx, activeTable)
	if err != nil {
		return nil, err
	}
	return &domainsearch.MetadataResponse{
		Metadata:       toDomainColumnMeta(columns, countKeys),
		TableTimestamp: activeTable.Timestamp,
		TableVersion:   tableVersion(activeTable),
	}, nil
}

func (r *SearchReader) FetchSearchData(
	c *fiber.Ctx,
	version domainsearch.TableVersion,
	query, selectClause string,
) ([]map[string]any, error) {
	active, err := r.ActiveTableVersion(c)
	if err != nil {
		return nil, err
	}
	if !sameTableVersion(active, version) {
		return nil, fmt.Errorf("active dataset changed; retry search")
	}
	if r.store.db == nil {
		return r.store.GetColumnWhere(version.TableData, selectClause, query)
	}
	ctx := context.Background()
	if c != nil {
		ctx = c.UserContext()
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	resolve := func(e *searchquery.Expression) (structureMatches, error) {
		flags := e.StructureFlags
		matches, err := r.store.searchStructures(ctx, e.Value, []string{e.Column}, 100000, chemistry.Options{BondOrder: flags[0], AllowHeteroAtoms: flags[1], Stereochemistry: flags[2]}, false, version.TableData)
		set := false
		if len(matches) > 0 {
			column, parseErr := metadata.ColumnFromLegacy([]string{"", e.Column, matches[0].Type, "", ""})
			if parseErr != nil {
				return structureMatches{}, parseErr
			}
			set = column.DataType == "set"
		}

		values := make([]string, len(matches))
		for n, m := range matches {
			values[n] = m.Value
		}
		return structureMatches{values: values, set: set}, err
	}
	nameLists := map[string]bool{}
	if strings.Contains(query, "CONTAINS") {
		// Read definitions belonging to the pinned dataset, not a newly active one.
		var meta string
		if err := r.store.db.QueryRowContext(ctx, `SELECT table_meta FROM chemdb.tables WHERE table_data=$1`, version.TableData).Scan(&meta); err != nil {
			return nil, err
		}
		quoted, err := pgTable(meta)
		if err != nil {
			return nil, err
		}
		rows, err := r.store.db.QueryContext(ctx, `SELECT "column",type FROM `+quoted)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var column, kind string
			if err := rows.Scan(&column, &kind); err != nil {
				return nil, err
			}
			if metadata.IsChemicalNameList(column, kind) {
				nameLists[column] = true
			}
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
	}
	return r.store.pgSearchWhere(ctx, version.TableData, selectClause, query, resolve, nameLists)
}

func tableVersion(table *Table) domainsearch.TableVersion {
	return domainsearch.TableVersion{Timestamp: table.Timestamp, Version: table.Version, TableData: table.TableData}
}

func sameTableVersion(left, right domainsearch.TableVersion) bool {
	return left.Timestamp.Equal(right.Timestamp) && left.Version == right.Version && left.TableData == right.TableData
}

func toDomainColumnMeta(columns []*ColumnMeta, countKeys map[string]string) []domainsearch.ColumnMeta {
	out := make([]domainsearch.ColumnMeta, len(columns))
	for i, col := range columns {
		out[i] = domainsearch.ColumnMeta{
			Column:      col.Column,
			Name:        col.Name,
			Type:        col.Type,
			Description: col.Description,
		}
		switch col.Column {
		case countKeys["species"]:
			out[i].EntityCountKey = "species"
		case countKeys["chemical"]:
			out[i].EntityCountKey = "chemical"
		}
	}
	return out
}

// EntityCountColumns reads the immutable definition pinned to this dataset.
// Datasets predating metadata versions retain their existing response shape.
func (s *Store) EntityCountColumns(ctx context.Context, table *Table) (map[string]string, error) {
	if s == nil || s.db == nil || table == nil || table.MetadataVersion == nil {
		return nil, nil
	}
	var raw []byte
	if err := s.db.QueryRowContext(ctx, `SELECT document FROM chemdb.metadata_versions WHERE version=$1`, *table.MetadataVersion).Scan(&raw); err != nil {
		return nil, err
	}
	var document metadata.Document
	if err := json.Unmarshal(raw, &document); err != nil {
		return nil, err
	}
	return document.EntityCountColumns(), nil
}
