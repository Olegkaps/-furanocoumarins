package tables

import (
	"github.com/gofiber/fiber/v2"

	"admin/internal/app"
	"admin/internal/infrastructure/persistence"
	"admin/internal/presentation/http/deps"
	"admin/internal/presentation/http/response"
)

type Handler struct {
	deps.Handler
}

func NewHandler(container *app.Container) *Handler {
	return &Handler{Handler: deps.New(container)}
}

// GetTablesList godoc
// @Summary      Get list of all tables
// @Description  Returns all tables from Cassandra
// @Tags         tables
// @Security     BearerAuth
// @Produce      json
// @Success      200 {array} cassandra.Table
// @Failure      500 {object} response.ErrorResponse
// @Router       /get-tables-list [post]
func (h *Handler) GetTablesList(c *fiber.Ctx) error {
	tables, err := h.Container.Cassandra.GetAllTables()
	if err != nil {
		return response.RespErr(c, err)
	}
	return response.JSON(c, tables)
}

// ActivateTable godoc
// @Summary      Activate table by timestamp
// @Description  Sets the given table as the active one
// @Tags         tables
// @Security     BearerAuth
// @Param        timestamp path string true "Table timestamp" example(2026-01-15T12:00:00.000Z)
// @Success      200
// @Failure      400,500 {object} response.ErrorResponse
// @Router       /make-table-active/{timestamp} [post]
func (h *Handler) ActivateTable(c *fiber.Ctx) error {
	tableTime, err := persistence.String2Time(c, c.Params("timestamp"))
	if err != nil {
		return response.Resp400(c, err)
	}

	if err := h.Container.Cassandra.ActivateTable(tableTime); err != nil {
		return response.RespErr(c, err)
	}
	if err := h.Container.Search.RefreshActiveTableVersion(c); err != nil {
		return response.RespErr(c, err)
	}
	return response.Resp200(c)
}

// DeleteTable godoc
// @Summary      Delete table by timestamp
// @Description  Deletes the table with the given timestamp
// @Tags         tables
// @Security     BearerAuth
// @Param        timestamp path string true "Table timestamp" example(2026-01-15T12:00:00.000Z)
// @Success      200
// @Failure      400,500 {object} response.ErrorResponse
// @Router       /table/{timestamp} [delete]
func (h *Handler) DeleteTable(c *fiber.Ctx) error {
	tableTime, err := persistence.String2Time(c, c.Params("timestamp"))
	if err != nil {
		return response.Resp400(c, err)
	}

	if err := h.Container.Cassandra.DeleteTable(c, tableTime); err != nil {
		return response.RespErr(c, err)
	}
	return response.Resp200(c)
}

// DeleteAllBadTables godoc
// @Summary      Delete all bad tables
// @Description  Deletes all tables that are not marked as OK
// @Tags         tables
// @Security     BearerAuth
// @Success      200
// @Failure      500 {object} response.ErrorResponse
// @Router       /tables [delete]
func (h *Handler) DeleteAllBadTables(c *fiber.Ctx) error {
	if err := h.Container.Cassandra.DeleteAllBadTables(c); err != nil {
		return response.RespErr(c, err)
	}
	return response.Resp200(c)
}
