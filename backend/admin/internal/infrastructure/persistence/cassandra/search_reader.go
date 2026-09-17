package cassandra

import (
	"admin/internal/chemistry"
	"admin/internal/pkg/metadata"
	"admin/internal/pkg/searchquery"
	"context"
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
	return domainsearch.TableVersion{
		Timestamp: table.Timestamp,
		Version:   table.Version,
		TableData: table.TableData,
	}, nil
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

	return &domainsearch.MetadataResponse{
		Metadata:       toDomainColumnMeta(columns),
		TableTimestamp: activeTable.Timestamp,
	}, nil
}

func (r *SearchReader) FetchSearchData(
	c *fiber.Ctx,
	version domainsearch.TableVersion,
	query, selectClause string,
) ([]map[string]any, error) {
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

func toDomainColumnMeta(columns []*ColumnMeta) []domainsearch.ColumnMeta {
	out := make([]domainsearch.ColumnMeta, len(columns))
	for i, col := range columns {
		out[i] = domainsearch.ColumnMeta{
			Column:      col.Column,
			Name:        col.Name,
			Type:        col.Type,
			Description: col.Description,
		}
	}
	return out
}
