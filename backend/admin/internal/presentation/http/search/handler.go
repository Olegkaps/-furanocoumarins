package search

import (
	"fmt"

	"github.com/gofiber/fiber/v2"

	domainsearch "admin/internal/domain/search"
	"admin/internal/app"
	"admin/internal/presentation/http/deps"
	"admin/internal/presentation/http/response"
)

type Handler struct {
	deps.Handler
}

func NewHandler(container *app.Container) *Handler {
	return &Handler{Handler: deps.New(container)}
}

type AutocompleteResponse struct {
	Values []string `json:"values" example:"Angelica archangelica,Angelica dahurica"`
}

// Swagger aliases for generated docs.
type (
	MetadataResponse = domainsearch.MetadataResponse
	SearchResponse   = domainsearch.SearchResponse
)

// SearchMainApp godoc
// @Summary      Search main app data
// @Description  Searches the active table by query string
// @Tags         search
// @Param        q query string true "Search query" example(species = 'Angelica')
// @Produce      json
// @Success      200 {object} SearchResponse
// @Failure      400,500 {object} response.ErrorResponse
// @Router       /search [get]
func (h *Handler) SearchMainApp(c *fiber.Ctx) error {
	result, err := h.Container.Search.Search(c, c.Query("q"))
	if err != nil {
		return response.RespErr(c, err)
	}
	return response.JSON(c, result)
}

// GetCurrentMetadata godoc
// @Summary      Get current table metadata
// @Description  Returns metadata and timestamp of the active table
// @Tags         search
// @Produce      json
// @Success      200 {object} MetadataResponse
// @Failure      500 {object} response.ErrorResponse
// @Router       /metadata [get]
func (h *Handler) GetCurrentMetadata(c *fiber.Ctx) error {
	result, err := h.Container.Search.GetMetadata(c)
	if err != nil {
		return response.RespErr(c, err)
	}
	return response.JSON(c, result)
}

// Autocomplete godoc
// @Summary      Autocomplete column values
// @Description  Returns prefix-matched values for a column
// @Tags         search
// @Param        column path string true "Column name" example(species)
// @Param        value query string true "Prefix to match" example(Angel)
// @Produce      json
// @Success      200 {object} AutocompleteResponse
// @Failure      400,500 {object} response.ErrorResponse
// @Router       /autocomplete/{column} [get]
func (h *Handler) Autocomplete(c *fiber.Ctx) error {
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
