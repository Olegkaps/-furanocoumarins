package pages

import (
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/xuri/excelize/v2"

	"admin/internal/infrastructure/persistence/cassandra"
	"admin/internal/presentation/http/deps"
	"admin/internal/presentation/http/response"
)

const maxTaxonIDMappingFile = 5 << 20
const maxTaxonIDMappingRows = 20000
const maxTaxonIDMappingUnzipped = 16 << 20
const maxTaxonIDMappingCells = 200000

func defaultTaxonIDMappingConfig() cassandra.TaxonIDMappingConfig {
	return cassandra.TaxonIDMappingConfig{Sheet: "TaxonIDs", NameColumn: "name", RankColumn: "rank", IDColumns: map[string]string{"ncbi": "ncbi_taxid", "ena": "ena_taxid", "uniprot": "uniprot_taxid", "ensembl-plants": "ensembl_taxid"}}
}

func (h *Handler) GetTaxonIDMapping(c *fiber.Ctx) error {
	v, err := h.Container.Cassandra.LatestTaxonIDMapping(c.UserContext())
	if errors.Is(err, sql.ErrNoRows) {
		return c.JSON(fiber.Map{"version": 0, "config": defaultTaxonIDMappingConfig(), "row_count": 0})
	}
	if err != nil {
		return response.RespErr(c, err)
	}
	return c.JSON(v)
}

func (h *Handler) PostTaxonIDMapping(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return response.Resp400(c, fmt.Errorf("mapping file is required"))
	}
	if file.Size > maxTaxonIDMappingFile {
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(response.ErrorResponse{Error: "mapping file exceeds 5 MiB"})
	}
	config := defaultTaxonIDMappingConfig()
	if raw := c.FormValue("config"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &config); err != nil {
			return response.Resp400(c, fmt.Errorf("invalid mapping config: %w", err))
		}
	}
	if err := normalizeTaxonIDMappingConfig(&config); err != nil {
		return response.Resp400(c, err)
	}
	base, err := strconv.ParseInt(c.FormValue("base_version"), 10, 64)
	if err != nil || base < 0 {
		return response.Resp400(c, fmt.Errorf("base_version must be a nonnegative integer"))
	}
	rows, err := parseTaxonIDMapping(file.Filename, file, config)
	if err != nil {
		return response.Resp400(c, err)
	}
	actor, err := deps.AuthEmail(c)
	if err != nil {
		return response.Resp401(c, err)
	}
	saved, err := h.Container.Cassandra.SaveTaxonIDMapping(c.UserContext(), base, config, rows, actor)
	if errors.Is(err, cassandra.ErrTaxonIDMappingConflict) {
		return c.Status(fiber.StatusConflict).JSON(response.ErrorResponse{Error: err.Error()})
	}
	if err != nil {
		return response.RespErr(c, err)
	}
	return c.Status(fiber.StatusCreated).JSON(saved)
}

func parseTaxonIDMapping(filename string, file *multipart.FileHeader, config cassandra.TaxonIDMappingConfig) ([]cassandra.TaxonIDMappingRow, error) {
	if err := normalizeTaxonIDMappingConfig(&config); err != nil {
		return nil, err
	}
	opened, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer opened.Close()
	return parseTaxonIDMappingReader(filename, opened, config)
}

func parseTaxonIDMappingReader(filename string, opened io.Reader, config cassandra.TaxonIDMappingConfig) ([]cassandra.TaxonIDMappingRow, error) {
	var records [][]string
	var err error
	if strings.HasSuffix(strings.ToLower(filename), ".csv") {
		records, err = csv.NewReader(io.LimitReader(opened, maxTaxonIDMappingFile+1)).ReadAll()
	} else {
		book, e := excelize.OpenReader(io.LimitReader(opened, maxTaxonIDMappingFile+1), excelize.Options{UnzipSizeLimit: maxTaxonIDMappingUnzipped, UnzipXMLSizeLimit: maxTaxonIDMappingUnzipped})
		if e != nil {
			return nil, fmt.Errorf("read mapping workbook: %w", e)
		}
		defer book.Close()
		rows, e := book.Rows(config.Sheet)
		if e != nil {
			return nil, fmt.Errorf("read mapping rows: %w", e)
		}
		defer rows.Close()
		cells := 0
		for rows.Next() {
			row, e := rows.Columns()
			if e != nil {
				return nil, fmt.Errorf("read mapping rows: %w", e)
			}
			cells += len(row)
			if len(records) >= maxTaxonIDMappingRows+1 || cells > maxTaxonIDMappingCells {
				return nil, fmt.Errorf("mapping exceeds row or cell limit")
			}
			records = append(records, row)
		}
		err = rows.Error()
	}
	if err != nil {
		return nil, fmt.Errorf("read mapping rows: %w", err)
	}
	return taxonIDMappingRows(records, config)
}
func normalizeTaxonIDMappingConfig(config *cassandra.TaxonIDMappingConfig) error {
	config.Sheet, config.NameColumn, config.RankColumn = strings.TrimSpace(config.Sheet), strings.TrimSpace(config.NameColumn), strings.TrimSpace(config.RankColumn)
	if config.Sheet == "" || config.NameColumn == "" || config.RankColumn == "" || len(config.IDColumns) == 0 {
		return fmt.Errorf("config requires sheet, name_column, rank_column, and id_columns")
	}
	if config.NameColumn == config.RankColumn {
		return fmt.Errorf("mapping config name_column and rank_column must differ")
	}
	seen := map[string]bool{config.NameColumn: true, config.RankColumn: true}
	normalized := make(map[string]string, len(config.IDColumns))
	for source, column := range config.IDColumns {
		source, column = strings.TrimSpace(source), strings.TrimSpace(column)
		if source == "" || column == "" || seen[column] || normalized[source] != "" {
			return fmt.Errorf("mapping config has duplicate or empty columns")
		}
		normalized[source] = column
		seen[column] = true
	}
	config.IDColumns = normalized
	return nil
}
func taxonIDMappingRows(records [][]string, config cassandra.TaxonIDMappingConfig) ([]cassandra.TaxonIDMappingRow, error) {
	if len(records) < 2 {
		return nil, fmt.Errorf("mapping must include a header and at least one row")
	}
	if len(records)-1 > maxTaxonIDMappingRows {
		return nil, fmt.Errorf("mapping exceeds %d rows", maxTaxonIDMappingRows)
	}
	header := map[string]int{}
	seenHeader := map[string]bool{}
	for i, cell := range records[0] {
		name := strings.TrimSpace(cell)
		if seenHeader[name] {
			return nil, fmt.Errorf("mapping header duplicates %q", name)
		}
		seenHeader[name] = true
		header[name] = i
	}
	columns := []string{config.NameColumn, config.RankColumn}
	for _, column := range config.IDColumns {
		columns = append(columns, column)
	}
	for _, column := range columns {
		if _, ok := header[column]; !ok {
			return nil, fmt.Errorf("mapping header is missing %q", column)
		}
	}
	result := make([]cassandra.TaxonIDMappingRow, 0, len(records)-1)
	seen := map[string]bool{}
	cell := func(row []string, column string) string {
		i := header[column]
		if i >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[i])
	}
	for i, row := range records[1:] {
		name := cell(row, config.NameColumn)
		rank, err := strconv.Atoi(cell(row, config.RankColumn))
		if err != nil || name == "" || rank < 0 || rank > 1000 {
			return nil, fmt.Errorf("row %d requires a name and rank from 0 to 1000", i+2)
		}
		key := strconv.Itoa(rank) + "\x00" + name
		if seen[key] {
			return nil, fmt.Errorf("row %d duplicates name and rank", i+2)
		}
		seen[key] = true
		ids := map[string]string{}
		for source, column := range config.IDColumns {
			if value := cell(row, column); value != "" {
				ids[source] = value
			}
		}
		result = append(result, cassandra.TaxonIDMappingRow{Rank: rank, Name: name, IDs: ids})
	}
	return result, nil
}

func (h *Handler) GetTaxonExternalIDs(c *fiber.Ctx) error {
	rank, err := strconv.Atoi(c.Params("rank"))
	if err != nil || rank < 0 || rank > 1000 {
		return response.Resp400(c, fmt.Errorf("classification rank must be an integer from 0 to 1000"))
	}
	taxon, err := h.Container.Cassandra.Taxonomy(c.UserContext(), rank, c.Query("name"), c.Query("id"))
	if err != nil {
		return response.RespErr(c, err)
	}
	if taxon == nil {
		return response.Resp404(c)
	}
	if taxon.AmbiguousName {
		return c.Status(fiber.StatusConflict).JSON(response.ErrorResponse{Error: "taxon name is ambiguous; use the local taxon id"})
	}
	name := taxon.Name
	if rank == 0 {
		name = taxon.Title
	}
	version, ids, err := h.Container.Cassandra.TaxonExternalIDs(c.UserContext(), rank, name)
	if err != nil {
		return response.RespErr(c, err)
	}
	return c.JSON(fiber.Map{"version": version, "scientific_name": name, "rank": rank, "ids": ids})
}
