package pages

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"admin/internal/infrastructure/persistence/cassandra"
	"admin/internal/presentation/http/response"
)

const maxTaxonAvailabilityBody = 8 << 10

type taxonAvailabilityRequest struct {
	DatasetVersion time.Time                     `json:"dataset_version"`
	Snapshots      []cassandra.TaxonAvailability `json:"snapshots"`
}

type taxonAvailabilityResponse struct {
	DatasetVersion time.Time                     `json:"dataset_version"`
	Taxon          cassandra.TaxonLink           `json:"taxon"`
	Snapshots      []cassandra.TaxonAvailability `json:"snapshots"`
}

// GetTaxonAvailability returns browser-observed external provider counts for
// the resolved taxon in the active dataset. These counts are availability
// hints, not authoritative scientific data.
func (h *Handler) GetTaxonAvailability(c *fiber.Ctx) error {
	taxon, err := h.resolveTaxon(c)
	if err != nil {
		return respondTaxonAvailabilityLookupError(c, err)
	}
	snapshots, err := h.Container.Cassandra.TaxonAvailability(c.UserContext(), taxon.DatasetVersion, taxon)
	if err != nil {
		return response.RespErr(c, err)
	}
	return c.JSON(taxonAvailabilityResponse{DatasetVersion: taxon.DatasetVersion, Taxon: taxon.TaxonLink, Snapshots: snapshots})
}

// PutTaxonAvailability upserts successful browser-observed provider counts.
// DatasetVersion is returned by GET and prevents a stale page from writing to
// whichever dataset happens to become active later.
func (h *Handler) PutTaxonAvailability(c *fiber.Ctx) error {
	if len(c.Body()) > maxTaxonAvailabilityBody {
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(response.ErrorResponse{Error: "availability request is too large"})
	}
	var request taxonAvailabilityRequest
	if err := json.Unmarshal(c.Body(), &request); err != nil {
		return response.Resp400(c, fmt.Errorf("invalid availability request: %w", err))
	}
	if err := validateTaxonAvailability(request.Snapshots); err != nil {
		return response.Resp400(c, err)
	}
	taxon, err := h.resolveTaxon(c)
	if err != nil {
		return respondTaxonAvailabilityLookupError(c, err)
	}
	if request.DatasetVersion.IsZero() || !request.DatasetVersion.Equal(taxon.DatasetVersion) {
		return c.Status(fiber.StatusConflict).JSON(response.ErrorResponse{Error: "active dataset changed; refresh availability before saving"})
	}
	if err := h.Container.Cassandra.UpsertTaxonAvailability(c.UserContext(), request.DatasetVersion, taxon, request.Snapshots); err != nil {
		if err == cassandra.ErrTaxonAvailabilityDatasetChanged {
			return c.Status(fiber.StatusConflict).JSON(response.ErrorResponse{Error: err.Error()})
		}
		return response.RespErr(c, err)
	}
	snapshots, err := h.Container.Cassandra.TaxonAvailability(c.UserContext(), request.DatasetVersion, taxon)
	if err != nil {
		return response.RespErr(c, err)
	}
	return c.JSON(taxonAvailabilityResponse{DatasetVersion: request.DatasetVersion, Taxon: taxon.TaxonLink, Snapshots: snapshots})
}

func (h *Handler) resolveTaxon(c *fiber.Ctx) (*cassandra.Taxon, error) {
	rank, err := strconv.Atoi(c.Params("rank"))
	if err != nil {
		return nil, fmt.Errorf("classification rank must be an integer")
	}
	taxon, err := h.Container.Cassandra.Taxonomy(c.UserContext(), rank, c.Query("name"), c.Query("id"))
	if err != nil {
		return nil, err
	}
	if taxon == nil {
		return nil, errTaxonAvailabilityNotFound
	}
	return taxon, nil
}

var errTaxonAvailabilityNotFound = errors.New("taxon availability taxon not found")

func respondTaxonAvailabilityLookupError(c *fiber.Ctx, err error) error {
	if errors.Is(err, errTaxonAvailabilityNotFound) {
		return response.Resp404(c)
	}
	if strings.Contains(err.Error(), "classification rank must be an integer") || strings.Contains(err.Error(), "taxon name or source ID is required") {
		return response.Resp400(c, err)
	}
	return response.RespErr(c, err)
}

func validateTaxonAvailability(snapshots []cassandra.TaxonAvailability) error {
	if len(snapshots) == 0 || len(snapshots) > 12 {
		return fmt.Errorf("provide between 1 and 12 availability snapshots")
	}
	seen := make(map[string]bool, len(snapshots))
	for _, snapshot := range snapshots {
		snapshot.Source, snapshot.Type, snapshot.ExternalTaxID = strings.TrimSpace(snapshot.Source), strings.TrimSpace(snapshot.Type), strings.TrimSpace(snapshot.ExternalTaxID)
		if !supportedAvailability(snapshot.Source, snapshot.Type) {
			return fmt.Errorf("unsupported availability source or type")
		}
		if snapshot.ExternalTaxID == "" || len(snapshot.ExternalTaxID) > 512 || snapshot.Count < 0 {
			return fmt.Errorf("availability external_taxid and count are invalid")
		}
		labelSource := snapshot.Source == "geo" || snapshot.Source == "biostudies" || snapshot.Source == "pride" || snapshot.Source == "metabolights"
		if labelSource && (!strings.HasPrefix(snapshot.ExternalTaxID, "organism:") || strings.TrimSpace(strings.TrimPrefix(snapshot.ExternalTaxID, "organism:")) == "") {
			return fmt.Errorf("organism-label sources require an organism:<name> lookup identity")
		}
		key := snapshot.Source + "\x00" + snapshot.Type + "\x00" + snapshot.ExternalTaxID
		if seen[key] {
			return fmt.Errorf("availability snapshots must not duplicate source, type, and external_taxid")
		}
		seen[key] = true
	}
	return nil
}

func supportedAvailability(source, kind string) bool {
	switch source {
	case "uniprot", "pride":
		return kind == "proteome"
	case "geo", "biostudies":
		return kind == "expression"
	case "ensembl-plants":
		return kind == "genome"
	case "metabolights":
		return kind == "metabolome"
	case "ncbi":
		return kind == "genome" || kind == "chloroplast-genome" || kind == "mitochondrial-genome" || kind == "transcriptome" || kind == "sequencing-library"
	case "ena":
		return kind == "genome" || kind == "transcriptome" || kind == "sequencing-library"
	default:
		return false
	}
}
