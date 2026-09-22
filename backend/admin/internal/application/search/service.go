package search

import (
	"fmt"
	"strings"

	"github.com/gofiber/fiber/v2"

	domainsearch "admin/internal/domain/search"
)

// Service implements search and metadata business logic.
type Service struct {
	reader         domainsearch.Reader
	activeVersions domainsearch.ActiveVersionRegistry
}

func NewService(reader domainsearch.Reader, activeVersions domainsearch.ActiveVersionRegistry) *Service {
	return &Service{reader: reader, activeVersions: activeVersions}
}

func (s *Service) RefreshActiveTableVersion(c *fiber.Ctx) error {
	if s.activeVersions == nil {
		return nil
	}
	return s.activeVersions.RefreshActiveVersion(c)
}

func (s *Service) GetMetadata(c *fiber.Ctx) (*domainsearch.MetadataResponse, error) {
	return s.reader.FetchMetadata(c)
}

func (s *Service) Search(c *fiber.Ctx, query string) (*domainsearch.SearchResponse, error) {
	meta, err := s.GetMetadata(c)
	if err != nil {
		return nil, err
	}

	if err := ValidateRequest(query, meta.Metadata); err != nil {
		return nil, err
	}

	selectedColumns := VisibleColumns(meta.Metadata)
	selectedColumns = appendEntityCountColumns(selectedColumns, meta.Metadata)
	if len(selectedColumns) == 0 {
		return nil, fmt.Errorf("no visible columns found in table metadata")
	}

	version := meta.TableVersion
	if version.TableData == "" {
		version, err = s.reader.ActiveTableVersion(c)
		if err != nil {
			return nil, err
		}
	}

	data, err := s.reader.FetchSearchData(c, version, query, strings.Join(selectedColumns, ", "))
	if err != nil {
		return nil, err
	}

	return &domainsearch.SearchResponse{
		Metadata:       meta.Metadata,
		Data:           data,
		TableTimestamp: meta.TableTimestamp,
	}, nil
}

func appendEntityCountColumns(selected []string, metadata []domainsearch.ColumnMeta) []string {
	present := make(map[string]bool, len(selected))
	for _, column := range selected {
		present[column] = true
	}
	for _, column := range metadata {
		if column.EntityCountKey != "" && !present[column.Column] {
			selected = append(selected, column.Column)
			present[column.Column] = true
		}
	}
	return selected
}
