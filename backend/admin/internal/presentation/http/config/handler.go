// Package config exposes non-secret, deployment-configured UI copy.
package config

import (
	"github.com/gofiber/fiber/v2"

	"admin/internal/presentation/http/response"
	"admin/settings"
)

type Handler struct {
	config settings.Config
}

func New(config settings.Config) *Handler {
	return &Handler{config: config}
}

type Response struct {
	TaxonomyInfo                    string `json:"taxonomy_info"`
	ClassificationAutocompleteLabel string `json:"classification_autocomplete_label"`
	ClassificationAutocompleteHint  string `json:"classification_autocomplete_hint"`
}

func (h *Handler) Get(c *fiber.Ctx) error {
	return response.JSON(c, Response{
		TaxonomyInfo:                    h.config.TaxonomyInfo,
		ClassificationAutocompleteLabel: h.config.ClassificationAutocompleteLabel,
		ClassificationAutocompleteHint:  h.config.ClassificationAutocompleteHint,
	})
}
