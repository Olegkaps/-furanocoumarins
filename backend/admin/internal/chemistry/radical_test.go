//go:build rdkit && cgo

package chemistry

import (
	"context"
	"fmt"
	"testing"
)

func TestLocalHydrogenConstraintsAcrossModes(t *testing.T) {
	cases := []struct {
		query, target string
		want          bool
	}{
		{"OC", "CCOc1ccccc1", true}, // ordinary SMILES still permits extension
		{"O[CH3]", "COc1ccccc1", true},
		{"O[CH3]", "CCOc1ccccc1", false},
		{"c1ccc(O[CH3])cc1", "COc1ccc(CC)cc1", true}, // another radical may grow
		{"c1ccc(O[CH3])cc1", "COc1cc(CCC)ccc1", true},
		{"c1ccc(O[CH3])cc1", "COc1ccc(OC)cc1", true},
		{"c1ccc(O[CH3])cc1", "CCOc1ccccc1", false},
		{"c1ccc(O[CH3])cc1", "CC(C)Oc1ccccc1", false},
		{"c1ccc(O[CH2][CH3])cc1", "CCOc1ccc(CCC)cc1", true},
		{"c1ccc(O[CH2][CH3])cc1", "CCCOc1ccccc1", false},
		{"c1ccc(O[CH2][CH3])cc1", "CC(C)Oc1ccccc1", false},
		{"[OH]c1ccccc1", "Oc1ccc(CC)cc1", true},
		{"[OH]c1ccccc1", "COc1ccccc1", false},
		{"[13CH3]Oc1ccccc1", "[13CH3]Oc1ccc(CC)cc1", true},
		{"[13CH3]Oc1ccccc1", "COc1ccc(CC)cc1", false},
		{"c1ccc(O[CH3])cc1", "COc1ccc(COCC)cc1", true}, // other ethers remain open
	}
	for mask := 0; mask < 8; mask++ {
		options := Options{BondOrder: mask&1 != 0, AllowHeteroAtoms: mask&2 != 0, Stereochemistry: mask&4 != 0}
		for i, tc := range cases {
			t.Run(fmt.Sprintf("mode%d_case%d", mask, i), func(t *testing.T) {
				idx, err := NewIndex([]string{tc.target})
				if err != nil {
					t.Fatal(err)
				}
				defer idx.Close()
				matches, err := idx.Search(context.Background(), tc.query, options, 1)
				if err != nil {
					t.Fatal(err)
				}
				if (len(matches) == 1) != tc.want {
					t.Fatalf("%s in %s: got %v want %v", tc.query, tc.target, matches, tc.want)
				}
			})
		}
	}
}

func TestLocalHydrogenConstraintInWorker(t *testing.T) {
	idx, err := NewWorkerIndex(context.Background(), []string{"COc1ccc(CC)cc1", "CCOc1ccccc1"})
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	matches, err := idx.Search(context.Background(), "c1ccc(O[CH3])cc1", Options{AllowHeteroAtoms: true}, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 || matches[0] != "COc1ccc(CC)cc1" {
		t.Fatalf("local radical constraint lost in worker: %v", matches)
	}
}
