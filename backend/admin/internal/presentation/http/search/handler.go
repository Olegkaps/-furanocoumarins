package search

import (
	"admin/internal/autocomplete"
	"admin/internal/chemistry"
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"

	"admin/internal/app"
	domainsearch "admin/internal/domain/search"
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
// @Param        columns query string false "Comma-separated registered columns (1-8); returns distinct projected rows"
// @Param        limit query int false "Projection row limit (1-100, default 21); requires columns"
// @Produce      json
// @Success      200 {object} SearchResponse
// @Failure      400,500 {object} response.ErrorResponse
// @Router       /search [get]
func (h *Handler) SearchMainApp(c *fiber.Ctx) error {
	columns, limit, err := projectionOptions(c)
	if err != nil {
		return response.Resp400(c, err)
	}
	result, err := h.Container.Search.Search(c, c.Query("q"))
	if err != nil {
		return searchError(c, err)
	}
	if columns != nil {
		result, err = projectSearch(result, columns, limit)
		if err != nil {
			return response.RespErr(c, err)
		}
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
// @Description  Returns fuzzy case-insensitive values for a column
// @Tags         search
// @Param        column path string true "Column name" example(species)
// @Param        value query string true "Prefix to match" example(Angel)
// @Produce      json
// @Success      200 {object} AutocompleteResponse
// @Failure      400,500 {object} response.ErrorResponse
// @Router       /autocomplete/{column} [get]
func (h *Handler) Autocomplete(c *fiber.Ctx) error {
	value, columns, limit, err := autocompleteOptions(c)
	if err != nil {
		return response.Resp400(c, err)
	}
	scope := c.Query("scope")
	if scope != "" && scope != "search" {
		return response.Resp400(c, fmt.Errorf("unknown autocomplete scope"))
	}
	searchScope := scope == "search" || (c.Params("column") == "" && c.Query("columns") == "")
	var suggestions []autocomplete.Suggestion
	switch c.Query("mode", "text") {
	case "text":
		suggestions, err = h.Container.Cassandra.Autocomplete(c.UserContext(), value, columns, limit, searchScope)
	case "structure":
		opts, parseErr := structureOptions(c)
		if parseErr != nil {
			return response.Resp400(c, parseErr)
		}
		suggestions, err = h.Container.Cassandra.StructureAutocomplete(c.UserContext(), value, columns, limit, opts, searchScope)
	default:
		return response.Resp400(c, fmt.Errorf("unknown autocomplete mode"))
	}
	if err != nil {
		return searchError(c, err)
	}
	if c.Params("column") != "" {
		values := make([]string, 0, len(suggestions))
		for _, s := range suggestions {
			values = append(values, s.Value)
		}
		return response.JSON(c, AutocompleteResponse{Values: values})
	}
	return response.JSON(c, fiber.Map{"suggestions": suggestions})
}
func autocompleteOptions(c *fiber.Ctx) (string, []string, int, error) {
	value := strings.TrimSpace(c.Query("value"))
	if value == "" || len(value) > 1024 || !utf8.ValidString(value) {
		return "", nil, 0, fmt.Errorf("autocomplete value must contain 1–1024 UTF-8 bytes")
	}
	limit := 20
	if raw := c.Query("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 50 {
			return "", nil, 0, fmt.Errorf("autocomplete limit must be between 1 and 50")
		}
		limit = n
	}
	var columns []string
	if column := c.Params("column"); column != "" {
		columns = []string{column}
	} else if raw := c.Query("columns"); raw != "" {
		columns = strings.Split(raw, ",")
		if len(columns) > 64 {
			return "", nil, 0, fmt.Errorf("at most 64 autocomplete columns")
		}
		for i, c := range columns {
			columns[i] = strings.TrimSpace(c)
			if columns[i] == "" {
				return "", nil, 0, fmt.Errorf("empty autocomplete column")
			}
		}
	}
	return value, columns, limit, nil
}

func structureOptions(c *fiber.Ctx) (chemistry.Options, error) {
	opts := chemistry.Options{BondOrder: true, Stereochemistry: true}
	for key, dest := range map[string]*bool{"bond_order": &opts.BondOrder, "hetero_atoms": &opts.AllowHeteroAtoms, "stereochemistry": &opts.Stereochemistry} {
		raw := c.Query(key)
		if raw == "" {
			continue
		}
		if raw != "true" && raw != "false" {
			return opts, fmt.Errorf("%s must be true or false", key)
		}
		*dest = raw == "true"
	}
	return opts, nil
}

func searchError(c *fiber.Ctx, err error) error {
	if errors.Is(err, chemistry.ErrInvalidSMILES) {
		return response.Resp400(c, err)
	}
	if errors.Is(err, chemistry.ErrUnavailable) || errors.Is(err, chemistry.ErrBusy) || errors.Is(err, context.DeadlineExceeded) {
		c.Set("Retry-After", "1")
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": err.Error()})
	}
	return response.RespErr(c, err)
}
