package pages

import (
	"bytes"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"

	"admin/internal/infrastructure/persistence/cassandra"
)

func TestTaxonIDMappingRowsPreservesOpaqueIDsAndBlankCells(t *testing.T) {
	config := defaultTaxonIDMappingConfig()
	rows, err := taxonIDMappingRows([][]string{
		{"name", "rank", "ncbi_taxid", "ena_taxid", "uniprot_taxid", "ensembl_taxid"},
		{"Angelica archangelica", "0", "3747", "", "taxon:3747", ""},
	}, config)
	require.NoError(t, err)
	require.Equal(t, []cassandra.TaxonIDMappingRow{{Rank: 0, Name: "Angelica archangelica", IDs: map[string]string{"ncbi": "3747", "uniprot": "taxon:3747"}}}, rows)
}

func TestTaxonIDMappingRowsRejectsDuplicateHeader(t *testing.T) {
	_, err := taxonIDMappingRows([][]string{{"name", "rank", "name"}, {"Angelica", "1", ""}}, cassandra.TaxonIDMappingConfig{Sheet: "TaxonIDs", NameColumn: "name", RankColumn: "rank", IDColumns: map[string]string{"ncbi": "name"}})
	require.ErrorContains(t, err, "duplicates")
}

func TestTaxonIDMappingConfigRejectsSameNameAndRankColumn(t *testing.T) {
	err := normalizeTaxonIDMappingConfig(&cassandra.TaxonIDMappingConfig{Sheet: "TaxonIDs", NameColumn: "taxon", RankColumn: "taxon", IDColumns: map[string]string{"ncbi": "id"}})
	require.ErrorContains(t, err, "must differ")
}

func TestTaxonIDMappingRejectsCompressedOversizedWorkbook(t *testing.T) {
	book := excelize.NewFile()
	for i := 0; i < 520; i++ {
		require.NoError(t, book.SetCellValue("Sheet1", fmt.Sprintf("A%d", i+1), fmt.Sprintf("%04d-%s", i, strings.Repeat("x", 32700))))
	}
	var encoded bytes.Buffer
	require.NoError(t, book.Write(&encoded))
	require.Less(t, encoded.Len(), maxTaxonIDMappingFile)
	_, err := parseTaxonIDMappingReader("mapping.xlsx", bytes.NewReader(encoded.Bytes()), defaultTaxonIDMappingConfig())
	require.ErrorContains(t, err, "unzip")
}

func TestTaxonIDMappingRowsRejectsDuplicateNormalizedKey(t *testing.T) {
	_, err := taxonIDMappingRows([][]string{
		{"name", "rank", "ncbi_taxid", "ena_taxid", "uniprot_taxid", "ensembl_taxid"},
		{"Angelica", "1", "", "", "", ""},
		{" Angelica ", "1", "3747", "", "", ""},
	}, defaultTaxonIDMappingConfig())
	require.ErrorContains(t, err, "duplicates name and rank")
}
