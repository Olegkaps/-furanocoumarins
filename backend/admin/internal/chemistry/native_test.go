//go:build rdkit && cgo

package chemistry

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
)

func TestSubstructureModes(t *testing.T) {
	strict := Options{BondOrder: true, Stereochemistry: true}
	relaxedBonds := Options{Stereochemistry: true}
	relaxedAtoms := Options{BondOrder: true, AllowHeteroAtoms: true, Stereochemistry: true}
	for _, tt := range []struct {
		name, query, target string
		opts                Options
		want                bool
	}{
		{"contained", "CCO", "CCCO", strict, true},
		{"wrong element", "CCO", "CCCN", strict, false},
		{"strict single", "CC", "C=C", strict, false},
		{"relaxed single", "CC", "C=C", relaxedBonds, true},
		{"explicit double retained", "C=C", "CCC", relaxedBonds, false},
		{"explicit triple retained", "C#N", "C=N", relaxedBonds, false},
		{"carbon ring allows hetero", "C1CCCCC1", "C1CCNCC1", relaxedAtoms, true},
		{"strict carbon ring", "C1CCCCC1", "C1CCNCC1", strict, false},
		{"strict six ring excludes benzene", "C1CCCCC1", "c1ccccc1", strict, false},
		{"relaxed six ring includes benzene", "C1CCCCC1", "c1ccccc1", relaxedBonds, true},
		{"hetero relaxation keeps benzene hit", "C1CCCCC1", "c1ccccc1", Options{AllowHeteroAtoms: true}, true},
		{"six ring finds psoralen", "C1CCCCC1", "C1=CC(=O)OC2=CC3=C(C=CO3)C=C21", relaxedBonds, true},
		{"hetero relaxation keeps psoralen hit", "C1CCCCC1", "C1=CC(=O)OC2=CC3=C(C=CO3)C=C21", Options{AllowHeteroAtoms: true}, true},
		{"eight ring is not benzene", "C1CCCCCCC1", "c1ccccc1", relaxedBonds, false},
		{"eight ring is not psoralen", "C1CCCCCCC1", "C1=CC(=O)OC2=CC3=C(C=CO3)C=C21", Options{AllowHeteroAtoms: true}, false},
		{"eight ring finds eight ring", "C1CCCCCCC1", "C1CCCCCCC1", relaxedBonds, true},
		{"relaxed explicit double still required", "C1=CCCCC1", "C1CCCCC1", Options{AllowHeteroAtoms: true}, false},

		{"explicit oxygen retained", "C1COCCC1", "C1CNCCC1", relaxedAtoms, false},
		{"aromatic hetero", "c1ccccc1", "c1ccncc1", relaxedAtoms, true},
		{"aromatic remains aromatic", "c1ccccc1", "C1CCCCC1", relaxedAtoms, false},
		{"kekule aromatic normalization", "C1=CC=CC=C1", "c1ccccc1", strict, true},
		{"same stereo", "N[C@@H](C)C(=O)O", "N[C@@H](C)C(=O)O", strict, true},
		{"opposite stereo", "N[C@@H](C)C(=O)O", "N[C@H](C)C(=O)O", strict, false},
		{"ignore stereo", "N[C@@H](C)C(=O)O", "N[C@H](C)C(=O)O", Options{BondOrder: true}, true},
		{"explicit stereo missing in target", "N[C@@H](C)C(=O)O", "NC(C)C(=O)O", strict, false},
		{"trans cis", "F/C=C/F", "F/C=C\\F", strict, false},
		{"trans cis ignored", "F/C=C/F", "F/C=C\\F", Options{BondOrder: true}, true},
		{"isotope retained", "[13CH4]", "C", relaxedAtoms, false},
		{"charge retained", "[NH4+]", "N", relaxedAtoms, false},
		{"disconnected salt", "[Na+].[Cl-]", "[Cl-].[Na+]", strict, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			idx, err := NewIndex([]string{tt.target})
			if err != nil {
				t.Fatal(err)
			}
			defer idx.Close()
			got, err := idx.Search(context.Background(), tt.query, tt.opts, 10)
			if err != nil {
				t.Fatal(err)
			}
			if (len(got) > 0) != tt.want {
				t.Fatalf("query %s target %s got %v want %v", tt.query, tt.target, got, tt.want)
			}
		})
	}
}
func TestInvalidAndLifecycle(t *testing.T) {
	idx, err := NewIndex([]string{"CCO", "CCO", "not smiles"})
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	for _, s := range []string{"", "not smiles", "C1CC", "C\x00N", strings.Repeat("C", MaxSMILESBytes+1), strings.Repeat("C", 65), "CCO name"} {
		if _, err := idx.Search(context.Background(), s, Options{}, 10); !errors.Is(err, ErrInvalidSMILES) {
			t.Errorf("%q: %v", s, err)
		}
	}
	got, err := idx.Search(context.Background(), "C", Options{}, 10)
	if err != nil || len(got) != 1 {
		t.Fatalf("dedup/invalid targets: %v %v", got, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := idx.Search(ctx, "C", Options{}, 10); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := idx.Search(context.Background(), "C", Options{}, 0); err == nil {
		t.Fatal("zero limit accepted")
	}
	idx.Close()
	idx.Close()
	if _, err := idx.Search(context.Background(), "C", Options{}, 10); !errors.Is(err, ErrClosed) {
		t.Fatal(err)
	}
}
func TestConcurrentReadAndClose(t *testing.T) {
	idx, _ := NewIndex([]string{"CCO", "c1ccccc1"})
	var wg sync.WaitGroup
	for n := 0; n < 8; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := idx.Search(context.Background(), "C", Options{}, 10)
			if err != nil && !errors.Is(err, ErrClosed) && !errors.Is(err, ErrBusy) {
				t.Error(err)
			}
		}()
	}
	idx.Close()
	wg.Wait()
}

func TestCancelledIndexBuild(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if idx, err := NewIndexContext(ctx, []string{"CCO"}); !errors.Is(err, context.Canceled) || idx != nil {
		t.Fatalf("index %v error %v", idx, err)
	}
}
