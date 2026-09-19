package catalog

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/gofiber/fiber/v2"

	"admin/internal/app"
	"admin/internal/infrastructure/persistence/cassandra"
	"admin/internal/presentation/http/deps"
	"admin/internal/presentation/http/response"
)

type Handler struct{ deps.Handler }

func NewHandler(container *app.Container) *Handler { return &Handler{Handler: deps.New(container)} }

func (h *Handler) List(c *fiber.Ctx) error {
	kind := c.Params("kind")
	if kind != "chemicals" && kind != "species" && kind != "publications" {
		return response.Resp400(c, fmt.Errorf("catalog kind must be chemicals, species, or publications"))
	}
	pageSize, err := boundedPositiveInt(c.Query("page_size", "24"), 1, 100, "page_size")
	if err != nil {
		return response.Resp400(c, err)
	}
	after, before := c.Query("cursor"), c.Query("before")
	if after != "" && before != "" {
		return response.Resp400(c, fmt.Errorf("cursor and before cannot be used together"))
	}
	result, err := h.Container.Cassandra.GetCatalogPage(c.UserContext(), kind, after, before, pageSize)
	if errors.Is(err, cassandra.ErrCatalogUnavailable) {
		return c.Status(fiber.StatusConflict).JSON(response.ErrorResponse{Error: err.Error()})
	}
	if err != nil {
		return response.RespErr(c, err)
	}
	return response.JSON(c, result)
}

// Count is intentionally a separate endpoint so routine cursor-page requests
// remain index-backed seeks. The UI loads this once per catalog kind.
func (h *Handler) Count(c *fiber.Ctx) error {
	kind := c.Params("kind")
	if kind != "chemicals" && kind != "species" && kind != "publications" {
		return response.Resp400(c, fmt.Errorf("catalog kind must be chemicals, species, or publications"))
	}
	pageSize, err := boundedPositiveInt(c.Query("page_size", "24"), 1, 100, "page_size")
	if err != nil {
		return response.Resp400(c, err)
	}
	result, err := h.Container.Cassandra.GetCatalogCount(c.UserContext(), kind, pageSize)
	if errors.Is(err, cassandra.ErrCatalogUnavailable) {
		return c.Status(fiber.StatusConflict).JSON(response.ErrorResponse{Error: err.Error()})
	}
	if err != nil {
		return response.RespErr(c, err)
	}
	return response.JSON(c, result)
}

func (h *Handler) Record(c *fiber.Ctx) error {
	kind := c.Params("kind")
	if kind != "chemicals" && kind != "species" {
		return response.Resp400(c, fmt.Errorf("catalog record kind must be chemicals or species"))
	}
	column, value := c.Query("column"), c.Query("value")
	if column == "" || value == "" {
		return response.Resp400(c, fmt.Errorf("column and value are required"))
	}
	record, err := h.Container.Cassandra.GetCatalogRecord(c.UserContext(), kind, column, value)
	if errors.Is(err, cassandra.ErrCatalogUnavailable) {
		return c.Status(fiber.StatusConflict).JSON(response.ErrorResponse{Error: err.Error()})
	}
	if err != nil {
		return response.RespErr(c, err)
	}
	if record == nil {
		return response.Resp404(c)
	}
	return response.JSON(c, record)
}

// Get returns a source entity by its stable, catalog-declared primary ID.
func (h *Handler) Get(c *fiber.Ctx) error {
	kind, id := c.Params("kind"), c.Params("id")
	if kind != "chemicals" && kind != "species" {
		return response.Resp400(c, fmt.Errorf("catalog record kind must be chemicals or species"))
	}
	if id == "" {
		return response.Resp400(c, fmt.Errorf("id is required"))
	}
	record, err := h.Container.Cassandra.GetCatalogRecordByID(c.UserContext(), kind, id)
	if errors.Is(err, cassandra.ErrCatalogUnavailable) {
		return c.Status(fiber.StatusConflict).JSON(response.ErrorResponse{Error: err.Error()})
	}
	if err != nil {
		return response.RespErr(c, err)
	}
	if record == nil {
		return response.Resp404(c)
	}
	return response.JSON(c, record)
}

func boundedPositiveInt(raw string, min, max int, name string) (int, error) {
	value, err := strconv.Atoi(raw)
	if err != nil || value < min || value > max {
		return 0, fmt.Errorf("%s must be between %d and %d", name, min, max)
	}
	return value, nil
}
