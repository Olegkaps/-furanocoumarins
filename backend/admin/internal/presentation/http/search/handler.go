package search

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	appsearch "admin/internal/application/search"
	"admin/internal/app"
	"admin/internal/infrastructure/persistence/cassandra"
	"admin/internal/presentation/http/deps"
	"admin/internal/presentation/http/response"
)

type Handler struct {
	deps.Handler
}

func NewHandler(container *app.Container) *Handler {
	return &Handler{Handler: deps.New(container)}
}

type SearchResponse struct {
	Metadata       []*cassandra.ColumnMeta `json:"metadata"`
	Data           []map[string]any        `json:"data"`
	TableTimestamp time.Time               `json:"timestamp"`
}

type GetMetadataResponse struct {
	Metadata       []*cassandra.ColumnMeta `json:"metadata"`
	TableTimestamp time.Time               `json:"timestamp"`
}

type AutocompleteResponse struct {
	Values []string `json:"values"`
}

// Search_main_app godoc
// @Summary      Search main app data
// @Description  Searches the active table by query string
// @Tags         search
// @Param        q query string true "Search query"
// @Produce      json
// @Success      200 {object} SearchResponse
// @Failure      400,500 {object} response.ErrorResponse
// @Router       /search [get]
func (h *Handler) Search_main_app(c *fiber.Ctx) error {
	searchRequest := c.Query("q")

	activeTable, err := h.Container.Cassandra.GetActiveTable(c)
	if err != nil {
		return response.RespErr(c, err)
	}

	columns, err1 := h.Container.Cassandra.GetColumnMeta(c, activeTable)
	err2 := appsearch.ValidateRequest(searchRequest, columns)
	if err := errors.Join(err1, err2); err != nil {
		return response.RespErr(c, err)
	}

	selectedColumns := appsearch.VisibleColumns(columns)
	if len(selectedColumns) == 0 {
		return response.Resp400(c, fmt.Errorf("no visible columns found in table metadata"))
	}

	searchResults, err := h.Container.Cassandra.GetColumnWhere(
		activeTable.TableData,
		strings.Join(selectedColumns, ", "),
		searchRequest,
	)
	if err != nil {
		return response.RespErr(c, err)
	}

	return response.JSON(c, SearchResponse{
		Metadata:       columns,
		Data:           searchResults,
		TableTimestamp: activeTable.Timestamp,
	})
}

// Get_current_metadata godoc
// @Summary      Get current table metadata
// @Description  Returns metadata and timestamp of the active table
// @Tags         search
// @Produce      json
// @Success      200 {object} GetMetadataResponse
// @Failure      500 {object} response.ErrorResponse
// @Router       /metadata [get]
func (h *Handler) Get_current_metadata(c *fiber.Ctx) error {
	activeTable, err := h.Container.Cassandra.GetActiveTable(c)
	if err != nil {
		return response.RespErr(c, err)
	}

	columns, err := h.Container.Cassandra.GetColumnMeta(c, activeTable)
	if err != nil {
		return response.RespErr(c, err)
	}

	return response.JSON(c, GetMetadataResponse{
		Metadata:       columns,
		TableTimestamp: activeTable.Timestamp,
	})
}

// Autocomletion godoc
// @Summary      Autocomplete column values
// @Description  Returns prefix-matched values for a column
// @Tags         search
// @Param        column path string true "Column name"
// @Param        value query string true "Prefix to match"
// @Produce      json
// @Success      200 {object} AutocompleteResponse
// @Failure      400,500 {object} response.ErrorResponse
// @Router       /autocomplete/{column} [get]
func (h *Handler) Autocomletion(c *fiber.Ctx) error {
	column := c.Params("column")
	value := c.Query("value", "")
	if value == "" {
		return response.Resp400(c, fmt.Errorf("cannot autocomplete empty value"))
	}

	table, err := h.Container.Cassandra.GetActiveTable(c)
	if err != nil {
		return response.RespErr(c, err)
	}

	values, err := h.Container.Cassandra.GetPrefix(table.TableData, column, value)
	if err != nil {
		return response.RespErr(c, err)
	}

	return response.JSON(c, AutocompleteResponse{Values: values})
}
