//go:build rdkit && cgo

package chemistry

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"testing"
)

type workbookFixture struct {
	Source string `json:"source"`
	SHA256 string `json:"sha256"`
	RDKit  string `json:"rdkit"`
	Valid  []struct {
		Atoms     int    `json:"atoms"`
		SMILES    string `json:"smiles"`
		Canonical string `json:"canonical"`
		Reordered string `json:"reordered"`
	} `json:"valid"`
	Invalid []struct {
		SMILES string `json:"smiles"`
	} `json:"invalid"`
	Cases []struct {
		Query     string `json:"query"`
		BondOrder bool   `json:"bond_order"`
		Hetero    bool   `json:"hetero_atoms"`
		Stereo    bool   `json:"stereochemistry"`
		Matches   []int  `json:"matches"`
	} `json:"cases"`
}

func loadWorkbook(t *testing.T) workbookFixture {
	t.Helper()
	f, err := os.Open("testdata/workbook-oracle.json.gz")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	r, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	var data workbookFixture
	if err = json.NewDecoder(r).Decode(&data); err != nil {
		t.Fatal(err)
	}
	return data
}

// Expectations were generated independently using Python RDKit query objects.
// Every mode is compared over the entire source corpus, so false positives and
// false negatives both fail (not just a handful of expected hits).
func TestWorkbookSubstructureOracle(t *testing.T) {
	data := loadWorkbook(t)
	values := make([]string, len(data.Valid))
	for n, v := range data.Valid {
		values[n] = v.SMILES
	}
	idx, err := NewIndex(values)
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	t.Logf("%s sha256=%s: %d valid, %d invalid, %d mode queries, %d decisions; oracle RDKit %s", data.Source, data.SHA256, len(data.Valid), len(data.Invalid), len(data.Cases), len(data.Valid)*len(data.Cases), data.RDKit)
	for n, c := range data.Cases {
		t.Run(fmt.Sprintf("%03d/%s/bonds=%t/hetero=%t/stereo=%t", n, c.Query, c.BondOrder, c.Hetero, c.Stereo), func(t *testing.T) {
			got, err := idx.Search(context.Background(), c.Query, Options{BondOrder: c.BondOrder, AllowHeteroAtoms: c.Hetero, Stereochemistry: c.Stereo}, len(values))
			if err != nil {
				t.Fatal(err)
			}
			want := make([]string, len(c.Matches))
			for n, i := range c.Matches {
				want[n] = values[i]
			}
			if !slices.Equal(got, want) {
				gs := map[string]bool{}
				ws := map[string]bool{}
				for _, s := range got {
					gs[s] = true
				}
				for _, s := range want {
					ws[s] = true
				}
				reported := 0
				for _, s := range values {
					if gs[s] != ws[s] {
						t.Errorf("SMILES %s got=%t want=%t", s, gs[s], ws[s])
						reported++
						if reported == 8 {
							break
						}
					}
				}
				t.Errorf("matched %d; expected %d", len(got), len(want))
			}
		})
	}
}

func TestWorkbookEquivalentEncodings(t *testing.T) {
	data := loadWorkbook(t)
	for n, v := range data.Valid {
		// Some source molecules are intentionally larger than the interactive query
		// bound. The full oracle above still exercises them as indexed targets.
		t.Run(fmt.Sprintf("%d", n), func(t *testing.T) {
			idx, err := NewIndex([]string{v.SMILES})
			if err != nil {
				t.Fatal(err)
			}
			defer idx.Close()
			for _, query := range []string{v.Canonical, v.Reordered} {
				got, err := idx.Search(context.Background(), query, Options{BondOrder: true, Stereochemistry: true}, 1)
				if v.Atoms > 64 {
					if err != ErrInvalidSMILES {
						t.Fatalf("oversized query expected rejection: %v", err)
					}
					return
				}
				if err != nil || len(got) != 1 {
					t.Fatalf("equivalent encoding %q did not match %q: %v %v", query, v.SMILES, got, err)
				}
			}
		})
	}
}

func TestWorkbookInvalidStructures(t *testing.T) {
	data := loadWorkbook(t)
	idx, err := NewIndex([]string{"CC"})
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	for _, v := range data.Invalid {
		if _, err := idx.Search(context.Background(), v.SMILES, Options{BondOrder: true}, 1); err != ErrInvalidSMILES {
			t.Errorf("expected invalid SMILES %q: %v", v.SMILES, err)
		}
	}
}
