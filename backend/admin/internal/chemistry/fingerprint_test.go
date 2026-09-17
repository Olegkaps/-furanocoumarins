//go:build rdkit && cgo

package chemistry

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
)

func fingerprintCandidate(target, query Fingerprint, mode int) bool {
	if !target.Valid {
		return false
	}
	if !target.Screenable || !query.Screenable {
		return true
	}
	if target.Atoms < query.Atoms || target.Bonds < query.Bonds {
		return false
	}
	for _, feature := range query.Modes[mode] {
		if _, found := slices.BinarySearch(target.Modes[mode], feature); !found {
			return false
		}
	}
	return true
}

func TestFingerprintWorkerBoundaries(t *testing.T) {
	ctx := context.Background()
	got, err := Fingerprints(ctx, []string{"CCO", "bad smiles", "*", "[13CH3]O", strings.Repeat("C", MaxSMILESBytes+1)})
	if err != nil {
		t.Fatal(err)
	}
	if got[4].Valid {
		t.Fatal("oversized source indexed")
	}
	if !got[0].Valid || !got[0].Screenable || got[0].Atoms != 3 || got[0].Bonds != 2 || got[1].Valid || !got[2].Valid || got[2].Screenable {
		t.Fatalf("unexpected fingerprints: %+v", got)
	}
	for _, mode := range got[0].Modes {
		if len(mode) == 0 || !slices.IsSorted(mode) {
			t.Fatal("missing/unsorted features")
		}
		for _, v := range mode {
			if v <= 0 {
				t.Fatal("nonpositive token")
			}
		}
	}
	for _, value := range []string{"", "invalid", strings.Repeat("C", 65)} {
		if _, err := QueryFingerprint(ctx, value, Options{}); !errors.Is(err, ErrInvalidSMILES) {
			t.Fatalf("%q: %v", value, err)
		}
	}
	if _, err := Fingerprints(ctx, make([]string, MaxFingerprintBatch+1)); err == nil {
		t.Fatal("oversized batch accepted")
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := Fingerprints(canceled, []string{"C"}); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	// Fingerprint requests must not invalidate a worker's cached exact-match index.
	idx, err := NewWorkerIndex(ctx, []string{"CCO", "CCC"})
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	for n := 0; n < 3; n++ {
		matches, err := idx.Search(ctx, "O", Options{}, 10)
		if err != nil || !slices.Equal(matches, []string{"CCO"}) {
			t.Fatalf("%v %v", matches, err)
		}
		if _, err := Fingerprints(ctx, []string{"N"}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestFingerprintConstraintsNeverExcludeExactMatches(t *testing.T) {
	values := []string{"CO", "CCO", "O[CH3]", "OCC", "c1ccccc1", "C1CCCCC1", "C1CCNCC1", "C1CCCCCCC1", "C=C", "C#N", "[13CH3]O", "[NH3+]CC(=O)[O-]", "F[C@H](Cl)Br", "F[C@@H](Cl)Br", "*", "CC.CC"}
	idx, err := NewIndex(values)
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	targets := map[string]Fingerprint{}
	for _, value := range values {
		targets[value] = nativeFingerprint(value)
	}
	for _, query := range values {
		q := nativeFingerprint(query)
		for mode := 0; mode < 8; mode++ {
			opts := Options{BondOrder: mode&1 != 0, AllowHeteroAtoms: mode&2 != 0, Stereochemistry: mode&4 != 0}
			matches, err := idx.Search(context.Background(), query, opts, len(values))
			if err != nil {
				t.Fatal(err)
			}
			for _, value := range matches {
				if !fingerprintCandidate(targets[value], q, FingerprintMode(opts)) {
					t.Fatalf("false negative query=%s target=%s mode=%d", query, value, mode)
				}
			}
		}
	}
	// Local H and stereo intentionally remain postfilters, so their features agree.
	if !slices.Equal(nativeFingerprint("CO").Modes[1], nativeFingerprint("O[CH3]").Modes[1]) {
		t.Fatal("local H leaked into fingerprint")
	}
	if !slices.Equal(nativeFingerprint("F[C@H](Cl)Br").Modes[1], nativeFingerprint("F[C@@H](Cl)Br").Modes[1]) {
		t.Fatal("stereo leaked into fingerprint")
	}
}

// The independent workbook oracle covers 1,082,368 query/target decisions across
// every mode. Screening may admit extra candidates, but must retain every hit.
func TestWorkbookFingerprintOracle(t *testing.T) {
	data := loadWorkbook(t)
	targets := make([]Fingerprint, len(data.Valid))
	for n, v := range data.Valid {
		targets[n] = nativeFingerprint(v.SMILES)
		if !targets[n].Valid {
			t.Fatalf("invalid target %d", n)
		}
	}
	var tokenTotal, tokenMax, fallback int
	for _, target := range targets {
		if !target.Screenable {
			fallback++
		}
		for _, tokens := range target.Modes {
			tokenTotal += len(tokens)
			tokenMax = max(tokenMax, len(tokens))
		}
	}
	t.Logf("features mean per molecule/mode=%.1f max=%d fallback=%d/%d", float64(tokenTotal)/float64(len(targets)*4), tokenMax, fallback, len(targets))
	var candidates, matches, comparisons [8]int
	for _, c := range data.Cases {
		q := nativeFingerprint(c.Query)
		if !q.Valid {
			t.Fatalf("invalid query %s", c.Query)
		}
		opts := Options{BondOrder: c.BondOrder, AllowHeteroAtoms: c.Hetero, Stereochemistry: c.Stereo}
		mode := FingerprintMode(opts)
		statsMode := mode
		if c.Stereo {
			statsMode += 4
		}
		for _, n := range c.Matches {
			if !fingerprintCandidate(targets[n], q, mode) {
				t.Fatalf("false negative query=%s target=%s mode=%d", c.Query, data.Valid[n].SMILES, statsMode)
			}
		}
		for _, target := range targets {
			comparisons[statsMode]++
			if fingerprintCandidate(target, q, mode) {
				candidates[statsMode]++
			}
		}
		matches[statsMode] += len(c.Matches)
	}
	for mode := range candidates {
		t.Logf("mode=%d candidates=%d/%d (%.1f%%), exact hits=%d", mode, candidates[mode], comparisons[mode], 100*float64(candidates[mode])/float64(comparisons[mode]), matches[mode])
	}
	// Canonical reordering cannot change persisted screening tokens.
	for _, v := range data.Valid[:64] {
		a, b := nativeFingerprint(v.SMILES), nativeFingerprint(v.Reordered)
		for mode := 0; mode < 4; mode++ {
			if !slices.Equal(a.Modes[mode], b.Modes[mode]) {
				t.Fatalf("reordering changed mode %d: %s", mode, v.SMILES)
			}
		}
	}
}

func TestWorkbookFingerprintSpecificQueries(t *testing.T) {
	data := loadWorkbook(t)
	targets := make([]Fingerprint, len(data.Valid))
	for n, v := range data.Valid {
		targets[n] = nativeFingerprint(v.SMILES)
	}
	values := make([]string, len(data.Valid))
	for n, v := range data.Valid {
		values[n] = v.SMILES
	}
	idx, err := NewIndex(values)
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	for _, query := range []string{"C1=CC(=O)OC2=CC3=C(C=CO3)C=C21", "C1=CC2=C(C=CO2)C3=C1C=CC(=O)O3", "COc1cc2oc(=O)ccc2cc1", "C1CCCCCCC1", "C1C2C(=CC3OC=CC=3C=2OCC)OC(=O)C=1"} {
		q := nativeFingerprint(query)
		if !q.Valid {
			t.Fatalf("invalid benchmark %s", query)
		}
		for mode := 0; mode < 4; mode++ {
			count := 0
			for _, target := range targets {
				if fingerprintCandidate(target, q, mode) {
					count++
				}
			}
			hits, err := idx.Search(context.Background(), query, Options{BondOrder: mode&1 != 0, AllowHeteroAtoms: mode&2 != 0}, len(values))
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("query=%s mode=%d candidates=%d/%d (%.1f%%) exact=%d", query, mode, count, len(targets), 100*float64(count)/float64(len(targets)), len(hits))
		}
	}
}

func TestFingerprintRingAndBranchScreening(t *testing.T) {
	ring := nativeFingerprint("C1CCCCCCC1")
	benzene := nativeFingerprint("c1ccccc1")
	branch := nativeFingerprint("CC(C)C")
	chain := nativeFingerprint("CCCCCCCC")
	for mode := 0; mode < 4; mode++ {
		if fingerprintCandidate(benzene, ring, mode) {
			t.Fatalf("eight ring admitted by benzene mode%d", mode)
		}
		if fingerprintCandidate(chain, branch, mode) {
			t.Fatalf("unbranched chain admitted branched query mode%d", mode)
		}
	}
	// A larger fused graph may contain cycles beyond its RDKit ring basis.
	// This must retain the ten-member perimeter of two fused six-member rings.
	if !fingerprintCandidate(nativeFingerprint("C1CCC2CCCCC2C1"), nativeFingerprint("C1CCCCCCCCC1"), 2) {
		t.Fatal("fused perimeter incorrectly excluded")
	}
}

// Relaxing carbon/single bonds must not erase explicitly requested oxygen or
// double bonds. Additional target anchors still admit the wildcard query.
func TestFingerprintExplicitAnchorsAndCounts(t *testing.T) {
	for _, c := range []struct {
		query, target string
		candidate     bool
	}{
		{"CO", "CN", false}, {"CO", "NO", true},
		{"C=C", "CC", false}, {"C=C", "C=O", true},
		{"OCO", "NCCO", false}, {"OCO", "ONO", true},
		{"O.O.O", "O.O", false},
		{"C1CCC2CCCC2C1", "C1CCCC1C2CCCCC2", false},
		// Same ring sizes, different fusion positions: angular versus linear.
		{"C1=CC2=C(C=CO2)C3=C1C=CC(=O)O3", "C1=CC(=O)OC2=CC3=C(C=CO3)C=C21", false},
		{"C1=CC(=O)OC2=CC3=C(C=CO3)C=C21", "C1=CC2=C(C=CO2)C3=C1C=CC(=O)O3", false},
	} {
		q, target := nativeFingerprint(c.query), nativeFingerprint(c.target)
		if !q.Screenable || !target.Screenable {
			t.Fatal("small structure bypassed screening")
		}
		if got := fingerprintCandidate(target, q, 2); got != c.candidate {
			t.Errorf("%s in %s: got %v, want %v", c.query, c.target, got, c.candidate)
		}
	}
}

func TestFingerprintLargeTargetRemainsConservative(t *testing.T) {
	// Long source molecules are legal, unlike queries (>64 atoms). A budget
	// fallback must have no partial modes and must admit a valid small query.
	target := nativeFingerprint(strings.Repeat("C", 512))
	if !target.Valid {
		t.Fatal("bounded target rejected")
	}
	if !target.Screenable {
		for _, mode := range target.Modes {
			if len(mode) != 0 {
				t.Fatal("partial fallback tokens")
			}
		}
	}
	if !fingerprintCandidate(target, nativeFingerprint("CCCC"), 0) {
		t.Fatal("long-chain false negative")
	}
}

func TestFingerprintBudgetFallbackHasNoPartialModes(t *testing.T) {
	cage := "C12C3C4C1C5C2C3C45"
	target := nativeFingerprint(strings.Repeat(cage+".", 59) + cage)
	if !target.Valid || target.Screenable {
		t.Fatal("dense target should exceed conservative feature budget")
	}
	for _, tokens := range target.Modes {
		if len(tokens) != 0 {
			t.Fatal("partial target fingerprint published")
		}
	}
	if !fingerprintCandidate(target, nativeFingerprint(cage), 2) {
		t.Fatal("budget fallback excluded genuine hit")
	}
}
