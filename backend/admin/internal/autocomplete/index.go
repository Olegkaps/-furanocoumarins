// Package autocomplete owns the embedded, rebuildable value search index.
package autocomplete

import (
	"admin/internal/chemistry"
	"admin/internal/pkg/metadata"
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"unicode"

	"github.com/blevesearch/bleve/v2"
	_ "github.com/blevesearch/bleve/v2/analysis/analyzer/custom"
	_ "github.com/blevesearch/bleve/v2/analysis/token/lowercase"
	_ "github.com/blevesearch/bleve/v2/analysis/tokenizer/unicode"
	"github.com/blevesearch/bleve/v2/search/query"
)

type Condition struct {
	Column string `json:"column"`
	Type   string `json:"type"`
	Value  string `json:"value"`
}

type Suggestion struct {
	Column     string      `json:"column"`
	ShowName   string      `json:"show_name"`
	Value      string      `json:"value"`
	Type       string      `json:"type"`
	Group      string      `json:"group"`
	Conditions []Condition `json:"conditions,omitempty"`
}
type Entry struct {
	Suggestion
	Text string
}
type Index struct {
	index         bleve.Index
	entries       []Entry
	columns       map[string]bool
	searchColumns map[string]bool
	setColumns    map[string]bool
	structures    map[string]*chemistry.WorkerIndex
	structureMu   sync.Mutex
}

func New(ctx context.Context, entries []Entry, columns []string) (*Index, error) {
	mapping := bleve.NewIndexMapping()
	if err := mapping.AddCustomAnalyzer("values", map[string]interface{}{"type": "custom", "tokenizer": "unicode", "token_filters": []string{"to_lower"}}); err != nil {
		return nil, err
	}
	mapping.DefaultAnalyzer = "values"
	mapping.DefaultMapping.Dynamic = false
	field := bleve.NewTextFieldMapping()
	field.Analyzer = "values"
	field.Store = false
	field.IncludeTermVectors = false
	field.IncludeInAll = false
	mapping.DefaultMapping.AddFieldMappingsAt("text", field)
	keyword := bleve.NewKeywordFieldMapping()
	keyword.Store = false
	keyword.IncludeInAll = false
	mapping.DefaultMapping.AddFieldMappingsAt("column", keyword)
	index, err := bleve.NewMemOnly(mapping)
	if err != nil {
		return nil, err
	}
	out := &Index{index: index, entries: entries, columns: map[string]bool{}, searchColumns: map[string]bool{}, setColumns: map[string]bool{}}
	for _, column := range columns {
		out.columns[column] = true
	}
	batch := index.NewBatch()
	for i, e := range entries {
		c, parseErr := metadata.ColumnFromLegacy([]string{"", e.Column, e.Type, "", ""})
		if parseErr == nil && c.DataType == "set" {
			out.setColumns[e.Column] = true
		}
		if parseErr == nil && (c.Search || c.Smiles) {
			out.searchColumns[e.Column] = true
		}
		if err := ctx.Err(); err != nil {
			index.Close()
			return nil, err
		}
		if err = batch.Index(strconv.Itoa(i), map[string]string{"text": e.Value + " " + e.Text, "column": e.Column}); err != nil {
			index.Close()
			return nil, err
		}
		if batch.Size() >= 1000 {
			if err = index.Batch(batch); err != nil {
				index.Close()
				return nil, err
			}
			batch = index.NewBatch()
		}
	}
	if err = index.Batch(batch); err != nil {
		index.Close()
		return nil, err
	}
	return out, nil
}
func (i *Index) Close() error {
	for _, idx := range i.structures {
		idx.Close()
	}
	return i.index.Close()
}
func (i *Index) ValidateColumns(columns []string) error {
	for _, c := range columns {
		if !i.columns[c] {
			return fmt.Errorf("unknown autocomplete column %q", c)
		}
	}
	return nil
}
func (i *Index) Search(ctx context.Context, text string, columns []string, limit int) ([]Suggestion, error) {
	if err := i.ValidateColumns(columns); err != nil {
		return nil, err
	}
	words := strings.FieldsFunc(strings.ToLower(text), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) })
	if len(words) == 0 {
		return []Suggestion{}, nil
	}
	var parts []query.Query
	for _, word := range words {
		prefix := bleve.NewPrefixQuery(word)
		prefix.SetField("text")
		prefix.SetBoost(3)
		if len([]rune(word)) < 3 {
			parts = append(parts, prefix)
			continue
		}
		fuzzy := bleve.NewFuzzyQuery(word)
		fuzzy.SetField("text")
		fuzzy.SetFuzziness(1)
		parts = append(parts, bleve.NewDisjunctionQuery(prefix, fuzzy))
	}
	if len(columns) > 0 {
		var filters []query.Query
		for _, c := range columns {
			q := bleve.NewTermQuery(c)
			q.SetField("column")
			filters = append(filters, q)
		}
		parts = append(parts, bleve.NewDisjunctionQuery(filters...))
	}
	request := bleve.NewSearchRequestOptions(bleve.NewConjunctionQuery(parts...), limit, 0, false)
	result, err := i.index.SearchInContext(ctx, request)
	if err != nil {
		return nil, err
	}
	out := make([]Suggestion, 0, len(result.Hits))
	for _, hit := range result.Hits {
		n, err := strconv.Atoi(hit.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, i.entries[n].Suggestion)
	}
	return out, nil
}

// Structure searches selected SMILES columns against cached native molecules.
// Store serializes index access, including this lazy chemistry initialization.
func (i *Index) Structure(ctx context.Context, text string, columns []string, limit int, opts chemistry.Options) ([]Suggestion, error) {
	if err := i.ValidateColumns(columns); err != nil {
		return nil, err
	}
	selected := map[string]bool{}
	for _, c := range columns {
		selected[c] = true
	}
	groups := map[string][]Entry{}
	var order []string
	for _, c := range columns {
		if _, exists := groups[c]; !exists {
			groups[c] = nil
			order = append(order, c)
		}
	}
	for _, e := range i.entries {
		smiles := false
		for _, token := range strings.Fields(e.Type) {
			if strings.EqualFold(token, "smiles") {
				smiles = true
			}
		}
		if !smiles || (len(selected) > 0 && !selected[e.Column]) {
			continue
		}
		if _, ok := groups[e.Column]; !ok {
			order = append(order, e.Column)
		}
		groups[e.Column] = append(groups[e.Column], e)
	}
	i.structureMu.Lock()
	if i.structures == nil {
		i.structures = map[string]*chemistry.WorkerIndex{}
	}
	i.structureMu.Unlock()
	out := []Suggestion{}
	for _, column := range order {
		i.structureMu.Lock()
		idx := i.structures[column]
		if idx == nil {
			values := []string{}
			for _, e := range groups[column] {
				values = append(values, e.Value)
			}
			var err error
			idx, err = chemistry.NewWorkerIndex(ctx, values)
			if err != nil {
				i.structureMu.Unlock()
				return nil, err
			}
			i.structures[column] = idx
		}
		i.structureMu.Unlock()
		matches, err := idx.Search(ctx, text, opts, limit-len(out))
		if err != nil {
			return nil, err
		}
		found := map[string]bool{}
		for _, v := range matches {
			found[v] = true
		}
		for _, e := range groups[column] {
			if found[e.Value] {
				out = append(out, e.Suggestion)
			}
		}
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

// SearchColumns applies the metadata's home-search flags without changing the
// explicit-column API used by comparisons and result filters.
func (i *Index) SearchColumns(columns []string) ([]string, error) {
	if err := i.ValidateColumns(columns); err != nil {
		return nil, err
	}
	out := []string{}
	if len(columns) > 0 {
		for _, c := range columns {
			if i.searchColumns[c] {
				out = append(out, c)
			}
		}
		return out, nil
	}
	for c := range i.searchColumns {
		out = append(out, c)
	}
	return out, nil
}

func (i *Index) IsSetColumn(column string) bool { return i.setColumns[column] }
