package cassandra

import (
	"github.com/gofiber/fiber/v2"

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
	_ *fiber.Ctx,
	version domainsearch.TableVersion,
	query, selectClause string,
) ([]map[string]any, error) {
	return r.store.GetColumnWhere(version.TableData, selectClause, query)
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
