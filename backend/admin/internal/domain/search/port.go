package search

import (
	"time"

	"github.com/gofiber/fiber/v2"
)

// ColumnMeta describes a table column exposed to clients.
type ColumnMeta struct {
	Column      string `json:"column" example:"species"`
	Name        string `json:"name" example:"Species"`
	Type        string `json:"type" example:"text search"`
	Description string `json:"description" example:"Plant species name"`
}

// TableVersion identifies the currently active table for cache keys.
type TableVersion struct {
	Timestamp time.Time
	Version   string
	TableData string
}

// MetadataResponse is the result of /metadata.
type MetadataResponse struct {
	Metadata       []ColumnMeta `json:"metadata"`
	TableTimestamp time.Time    `json:"timestamp"`
}

// SearchResponse is the result of /search.
type SearchResponse struct {
	Metadata       []ColumnMeta     `json:"metadata"`
	Data           []map[string]any `json:"data"`
	TableTimestamp time.Time        `json:"timestamp"`
}

// Reader loads search and metadata data from persistence.
type Reader interface {
	ActiveTableVersion(c *fiber.Ctx) (TableVersion, error)
	FetchMetadata(c *fiber.Ctx) (*MetadataResponse, error)
	FetchSearchData(c *fiber.Ctx, version TableVersion, query, selectClause string) ([]map[string]any, error)
}

// ActiveVersionRegistry tracks the active table version used for cache keys.
type ActiveVersionRegistry interface {
	SetActiveVersion(version TableVersion)
	RefreshActiveVersion(c *fiber.Ctx) error
}
