package config

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/require"

	"admin/settings"
)

func TestGetReturnsConfiguredPublicCopy(t *testing.T) {
	app := fiber.New()
	app.Get("/config", New(settings.Config{
		TaxonomyInfo:                    "Configured taxonomy sources",
		ClassificationAutocompleteLabel: "rank one + rank zero",
		ClassificationAutocompleteHint:  "Configured from current ranks.",
	}).Get)

	resp, err := app.Test(httptest.NewRequest(fiber.MethodGet, "/config", nil))
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, fiber.StatusOK, resp.StatusCode)

	var body Response
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.Equal(t, "Configured taxonomy sources", body.TaxonomyInfo)
	require.Equal(t, "rank one + rank zero", body.ClassificationAutocompleteLabel)
	require.Equal(t, "Configured from current ranks.", body.ClassificationAutocompleteHint)
}
