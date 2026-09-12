package create

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"io"

	"admin/internal/infrastructure/logging"
	"admin/internal/infrastructure/persistence/cassandra"
	"admin/internal/pkg/metadata"
	"admin/internal/presentation/http/deps"
	"admin/internal/presentation/http/response"
	"github.com/gofiber/fiber/v2"
)

func (h *Handler) MetadataVersions(c *fiber.Ctx) error {
	versions, err := h.Container.Cassandra.MetadataVersions(c.UserContext())
	if err != nil {
		return metadataUnavailable(c, err)
	}
	return c.JSON(versions)
}
func (h *Handler) LatestMetadata(c *fiber.Ctx) error {
	v, err := h.latestMetadata(c.UserContext())
	if errors.Is(err, sql.ErrNoRows) {
		return response.Resp404(c)
	}
	if err != nil {
		return metadataUnavailable(c, err)
	}
	return c.JSON(v)
}
func (h *Handler) SaveMetadata(c *fiber.Ctx) error {
	actor, err := deps.AuthEmail(c)
	if err != nil {
		return response.Resp401(c, err)
	}
	if len(c.Body()) > metadata.MaxDocumentBytes {
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(response.ErrorResponse{Error: "metadata exceeds 1 MiB"})
	}
	var body struct {
		BaseVersion *int64          `json:"base_version"`
		Document    json.RawMessage `json:"document"`
	}
	d := json.NewDecoder(bytes.NewReader(c.Body()))
	d.DisallowUnknownFields()
	if err = d.Decode(&body); err != nil {
		return response.Resp400(c, err)
	}
	if err = d.Decode(new(any)); err != io.EOF || body.BaseVersion == nil || *body.BaseVersion < 0 {
		return c.Status(400).JSON(response.ErrorResponse{Error: "provide one object with nonnegative base_version and document"})
	}
	document, err := metadata.DecodeDraft(body.Document)
	if err != nil {
		return response.Resp400(c, err)
	}
	version, err := h.Container.Cassandra.SaveMetadata(c.UserContext(), *body.BaseVersion, document, actor)
	if errors.Is(err, cassandra.ErrMetadataConflict) {
		return c.Status(fiber.StatusConflict).JSON(response.ErrorResponse{Error: err.Error()})
	}
	if err != nil {
		return metadataUnavailable(c, err)
	}
	return c.Status(fiber.StatusCreated).JSON(version)
}

// ValidateMetadata checks a draft without publishing it or accessing persistence.
func (h *Handler) ValidateMetadata(c *fiber.Ctx) error {
	if len(c.Body()) > metadata.MaxDocumentBytes {
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(response.ErrorResponse{Error: "metadata exceeds 1 MiB"})
	}
	var body struct {
		Document json.RawMessage `json:"document"`
	}
	decoder := json.NewDecoder(bytes.NewReader(c.Body()))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		return response.Resp400(c, err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return c.Status(400).JSON(response.ErrorResponse{Error: "provide one object with document"})
	}
	document, err := metadata.DecodeDraft(body.Document)
	if err != nil {
		return response.Resp400(c, err)
	}
	resolved, err := document.ResolveJoins()
	if err != nil {
		return response.Resp400(c, err)
	}
	return c.JSON(fiber.Map{"valid": true, "resolved_document": resolved})
}
func metadataUnavailable(c *fiber.Ctx, err error) error {
	logging.Error(c, "metadata operation failed: %s", err)
	return c.Status(fiber.StatusServiceUnavailable).JSON(response.ErrorResponse{Error: "metadata is temporarily unavailable"})
}
