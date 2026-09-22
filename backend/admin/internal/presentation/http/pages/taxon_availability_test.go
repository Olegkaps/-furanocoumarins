package pages

import (
	"testing"

	"github.com/stretchr/testify/require"

	"admin/internal/infrastructure/persistence/cassandra"
)

func TestValidateTaxonAvailabilityAcceptsProviderTreeCounts(t *testing.T) {
	require.NoError(t, validateTaxonAvailability([]cassandra.TaxonAvailability{{
		Source: "ncbi", Type: "genome", ExternalTaxID: "9606", Count: 0,
	}, {
		Source: "uniprot", Type: "proteome", ExternalTaxID: "UP000005640", Count: 3,
	}}))
}

func TestValidateTaxonAvailabilityRejectsUnsupportedAndDuplicateSnapshots(t *testing.T) {
	require.Error(t, validateTaxonAvailability([]cassandra.TaxonAvailability{{Source: "other", Type: "genome", ExternalTaxID: "1", Count: 1}}))
	require.Error(t, validateTaxonAvailability([]cassandra.TaxonAvailability{{Source: "uniprot", Type: "genome", ExternalTaxID: "1", Count: 1}}))
	require.Error(t, validateTaxonAvailability([]cassandra.TaxonAvailability{{Source: "ncbi", Type: "genome", ExternalTaxID: "1", Count: 1}, {Source: "ncbi", Type: "genome", ExternalTaxID: "1", Count: 2}}))
}

func TestExpandedAvailabilitySourcesKeepTheirRecordTypes(t *testing.T) {
	require.NoError(t, validateTaxonAvailability([]cassandra.TaxonAvailability{{
		Source: "metabolights", Type: "metabolome", ExternalTaxID: "organism:Arabidopsis thaliana", Count: 73,
	}}))
	for _, pair := range [][2]string{
		{"geo", "expression"}, {"biostudies", "expression"},
		{"ensembl-plants", "genome"}, {"pride", "proteome"},
		{"metabolights", "metabolome"},
		{"ncbi", "chloroplast-genome"}, {"ncbi", "mitochondrial-genome"},
	} {
		t.Run(pair[0]+"/"+pair[1], func(t *testing.T) {
			identity := "4037"
			if pair[0] == "geo" || pair[0] == "biostudies" || pair[0] == "pride" || pair[0] == "metabolights" {
				identity = "organism:Daucus carota"
				for _, invalid := range []string{"4037", "organism: "} {
					require.Error(t, validateTaxonAvailability([]cassandra.TaxonAvailability{{Source: pair[0], Type: pair[1], ExternalTaxID: invalid, Count: 1}}))
				}
			}
			require.NoError(t, validateTaxonAvailability([]cassandra.TaxonAvailability{{
				Source: pair[0], Type: pair[1], ExternalTaxID: identity, Count: 0,
			}}))
		})
	}
	for _, kind := range []string{"chloroplast-genome", "mitochondrial-genome"} {
		require.Error(t, validateTaxonAvailability([]cassandra.TaxonAvailability{{
			Source: "ena", Type: kind, ExternalTaxID: "4037", Count: 1,
		}}))
	}
	for _, source := range []string{"geo", "biostudies", "ensembl-plants", "pride", "metabolights"} {
		require.Error(t, validateTaxonAvailability([]cassandra.TaxonAvailability{{
			Source: source, Type: "sequencing-library", ExternalTaxID: "4037", Count: 1,
		}}))
	}
}
