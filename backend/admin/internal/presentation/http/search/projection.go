package search

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	domainsearch "admin/internal/domain/search"
	"admin/internal/presentation/http/response"
	"github.com/gofiber/fiber/v2"
)

func projectionOptions(c *fiber.Ctx) ([]string, int, error) {
	args := c.Context().QueryArgs()
	if !args.Has("columns") {
		if args.Has("limit") {
			return nil, 0, fiber.NewError(400, "limit requires columns")
		}
		return nil, 0, nil
	}
	columns := strings.Split(c.Query("columns"), ",")
	if len(columns) > 8 {
		return nil, 0, fiber.NewError(400, "columns must contain 1 to 8 registered names")
	}
	seen := make(map[string]bool, len(columns))
	for _, column := range columns {
		if column == "" || seen[column] {
			return nil, 0, fiber.NewError(400, "columns must contain nonempty distinct names")
		}
		seen[column] = true
	}
	limit := 21
	if args.Has("limit") {
		var err error
		limit, err = strconv.Atoi(c.Query("limit"))
		if err != nil || limit < 1 || limit > 100 {
			return nil, 0, fiber.NewError(400, "limit must be an integer from 1 to 100")
		}
	}
	return columns, limit, nil
}

// projectSearch never edits the service's cached metadata or row maps.
func projectSearch(source *domainsearch.SearchResponse, columns []string, limit int) (*domainsearch.SearchResponse, error) {
	truncated := false
	result := &domainsearch.SearchResponse{
		Metadata:       make([]domainsearch.ColumnMeta, 0, len(columns)),
		Data:           make([]map[string]any, 0, limit),
		TableTimestamp: source.TableTimestamp,
		Truncated:      &truncated,
	}
	for _, column := range columns {
		found := false
		for _, meta := range source.Metadata {
			if meta.Column == column {
				result.Metadata = append(result.Metadata, meta)
				found = true
				break
			}
		}
		if !found {
			return nil, &response.UserError{E: fmt.Errorf("unknown projection column %q", column)}
		}
	}
	seen := make(map[string]bool, limit)
	for _, row := range source.Data {
		projected := make(map[string]any, len(columns))
		for _, column := range columns {
			projected[column] = row[column]
		}
		key, err := json.Marshal(projected)
		if err != nil {
			return nil, fmt.Errorf("encode projected search row: %w", err)
		}
		if seen[string(key)] {
			continue
		}
		if len(result.Data) == limit {
			truncated = true
			break
		}
		seen[string(key)] = true
		result.Data = append(result.Data, projected)
	}
	return result, nil
}
