package autocomplete

import (
	"context"
	"fmt"
	"github.com/stretchr/testify/require"
	"sync"
	"testing"
)

func TestValueSearch(t *testing.T) {
	entries := []Entry{
		{Suggestion: Suggestion{Column: "species", ShowName: "Species", Value: "Angelica archangelica"}},
		{Suggestion: Suggestion{Column: "chemical", Value: "Psoralen"}},
		{Suggestion: Suggestion{Column: "chemical", Value: "Bergapten"}},
		{Suggestion: Suggestion{Column: "reference", Value: "ref-19"}, Text: "Phototoxic furanocoumarins in Angelica by Müller 2026"},
	}
	idx, err := New(context.Background(), entries, []string{"species", "chemical", "reference", "empty"})
	require.NoError(t, err)
	defer idx.Close()
	for _, tt := range []struct {
		q    string
		cols []string
		want []string
	}{
		{"ANGEL", nil, []string{"Angelica archangelica", "ref-19"}},
		{"psorlen", nil, []string{"Psoralen"}},
		{"2026", nil, []string{"ref-19"}},
		{"archangelica", nil, []string{"Angelica archangelica"}},
		{"phototoxc müller", nil, []string{"ref-19"}},
		{"angel", []string{"reference"}, []string{"ref-19"}},
		{"angel", []string{"chemical"}, []string{}},
		{"angel", []string{"empty"}, []string{}},
		{"zzzzzzzzzz", nil, []string{}},
	} {
		t.Run(tt.q+fmt.Sprint(tt.cols), func(t *testing.T) {
			got, err := idx.Search(context.Background(), tt.q, tt.cols, 20)
			require.NoError(t, err)
			values := []string{}
			for _, s := range got {
				values = append(values, s.Value)
			}
			require.ElementsMatch(t, tt.want, values)
		})
	}
	_, err = idx.Search(context.Background(), "angel", []string{"unknown"}, 20)
	require.ErrorContains(t, err, "unknown")
	got, err := idx.Search(context.Background(), "angel", nil, 1)
	require.NoError(t, err)
	require.Len(t, got, 1)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = idx.Search(ctx, "angel", nil, 20)
	require.Error(t, err)
}
func BenchmarkValueAutocomplete(b *testing.B) {
	entries := make([]Entry, 10000)
	for n := range entries {
		entries[n] = Entry{Suggestion: Suggestion{Column: "species", Value: fmt.Sprintf("Angelica species %d", n)}}
	}
	idx, err := New(context.Background(), entries, []string{"species"})
	if err != nil {
		b.Fatal(err)
	}
	defer idx.Close()
	b.ResetTimer()
	for n := 0; n < b.N; n++ {
		if _, err := idx.Search(context.Background(), "angelca", nil, 20); err != nil {
			b.Fatal(err)
		}
	}
}

func TestConcurrentWarmSearchAndCancelledBuild(t *testing.T) {
	entries := []Entry{{Suggestion: Suggestion{Column: "name", Value: "Psoralen"}}}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := New(ctx, entries, []string{"name"})
	require.ErrorIs(t, err, context.Canceled)
	idx, err := New(context.Background(), entries, []string{"name"})
	require.NoError(t, err)
	defer idx.Close()
	var wg sync.WaitGroup
	for n := 0; n < 16; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 20; j++ {
				got, err := idx.Search(context.Background(), "psorlen", nil, 20)
				require.NoError(t, err)
				require.Len(t, got, 1)
			}
		}()
	}
	wg.Wait()
}

func TestHomeSearchScopeHonorsMetadataFlags(t *testing.T) {
	entries := []Entry{
		{Suggestion: Suggestion{Column: "enabled", Type: "text search", Value: "value"}},
		{Suggestion: Suggestion{Column: "hidden", Type: "text", Value: "value"}},
		{Suggestion: Suggestion{Column: "fake", Type: "set[search smiles]", Value: "value"}},
		{Suggestion: Suggestion{Column: "structure", Type: "SMILES", Value: "CC"}},
		{Suggestion: Suggestion{Column: "reference", Type: "ref[]", Value: "paper-1"}},
	}
	idx, err := New(context.Background(), entries, []string{"enabled", "hidden", "fake", "structure", "reference"})
	require.NoError(t, err)
	defer idx.Close()
	columns, err := idx.SearchColumns(nil)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"enabled", "structure", "reference"}, columns)
	columns, err = idx.SearchColumns([]string{"reference"})
	require.NoError(t, err)
	require.Equal(t, []string{"reference"}, columns)
	columns, err = idx.SearchColumns([]string{"hidden"})
	require.NoError(t, err)
	require.Empty(t, columns)
	found, err := idx.Search(context.Background(), "value", []string{"hidden"}, 20)
	require.NoError(t, err)
	require.Len(t, found, 1)
}
