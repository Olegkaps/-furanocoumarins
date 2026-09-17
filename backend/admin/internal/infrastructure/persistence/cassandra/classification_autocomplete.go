package cassandra

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"admin/internal/autocomplete"
	"admin/internal/pkg/metadata"
)

const classificationAutocompleteColumn = "__classification_name"

// Pair ranks only within the same classification system. Ambiguous searchable
// ranks are omitted rather than combining unrelated source columns.
func classificationAutocompletePairs(metas []autocomplete.Suggestion) [][2]autocomplete.Suggestion {
	groups := map[string][2][]autocomplete.Suggestion{}
	for _, m := range metas {
		if m.Column == classificationAutocompleteColumn {
			return nil
		}
		c, err := metadata.ColumnFromLegacy([]string{"", m.Column, m.Type, "", ""})
		if err != nil || !c.Search || c.Classification == nil || c.Classification.Level < 0 || c.Classification.Level > 1 {
			continue
		}
		ranks := groups[c.Classification.Tag]
		ranks[c.Classification.Level] = append(ranks[c.Classification.Level], m)
		groups[c.Classification.Tag] = ranks
	}
	tags := make([]string, 0, len(groups))
	for tag := range groups {
		tags = append(tags, tag)
	}
	sort.Strings(tags)
	var pairs [][2]autocomplete.Suggestion
	for _, tag := range tags {
		ranks := groups[tag]
		if len(ranks[0]) == 1 && len(ranks[1]) == 1 {
			pairs = append(pairs, [2]autocomplete.Suggestion{ranks[0][0], ranks[1][0]})
		}
	}
	return pairs
}

func classificationAutocompleteEntries(ctx context.Context, tx *sql.Tx, dataName string, metas []autocomplete.Suggestion, remaining int) ([]autocomplete.Entry, bool, error) {
	pairs := classificationAutocompletePairs(metas)
	entries := []autocomplete.Entry{}
	seen := map[string]bool{}
	add := func(value, showName string, conditions []autocomplete.Condition) error {
		if len(value) > 16384 {
			return fmt.Errorf("autocomplete value exceeds 16 KiB")
		}
		key, _ := json.Marshal(conditions)
		if seen[string(key)] {
			return nil
		}
		seen[string(key)] = true
		entries = append(entries, autocomplete.Entry{Suggestion: autocomplete.Suggestion{Column: classificationAutocompleteColumn, ShowName: showName, Type: "search specie", Group: "species", Value: value, Conditions: conditions}})
		if len(entries) > remaining {
			return fmt.Errorf("autocomplete exceeds one million distinct values")
		}
		return nil
	}
	for _, pair := range pairs {
		showName := "genus + species"
		c, _ := metadata.ColumnFromLegacy([]string{"", pair[0].Column, pair[0].Type, "", ""})
		if c.Classification.Tag != "" {
			showName += " (" + c.Classification.Tag + ")"
		}
		species, err := pgColumn(pair[0].Column)
		if err != nil {
			return nil, false, err
		}
		genus, err := pgColumn(pair[1].Column)
		if err != nil {
			return nil, false, err
		}
		// Expand sets within an observation, never between independent rank lists.
		members := func(col string) string {
			return `jsonb_array_elements_text(CASE WHEN jsonb_typeof(to_jsonb(` + col + `))='array' THEN to_jsonb(` + col + `) ELSE jsonb_build_array(` + col + `) END)`
		}
		rows, err := tx.QueryContext(ctx, `SELECT DISTINCT species.value,genus.value FROM `+dataName+` LEFT JOIN LATERAL `+members(species)+` species(value) ON true CROSS JOIN LATERAL `+members(genus)+` genus(value) WHERE genus.value IS NOT NULL AND genus.value <> '' ORDER BY 1,2`)
		if err != nil {
			return nil, false, err
		}
		for rows.Next() {
			var rawSpecies sql.NullString
			var rawGenus string
			if err = rows.Scan(&rawSpecies, &rawGenus); err != nil {
				break
			}
			g := strings.TrimSpace(rawGenus)
			s := strings.TrimSpace(rawSpecies.String)
			if g == "" || s == "" || strings.EqualFold(s, g) {
				continue
			}
			genusCondition := autocomplete.Condition{Column: pair[1].Column, Type: pair[1].Type, Value: rawGenus}
			label := s
			if !strings.HasPrefix(strings.ToLower(s), strings.ToLower(g)+" ") {
				label = g + " " + s
			}
			if err = add(label, showName, []autocomplete.Condition{{Column: pair[0].Column, Type: pair[0].Type, Value: rawSpecies.String}, genusCondition}); err != nil {
				break
			}
		}
		if err == nil {
			err = rows.Err()
		}
		err = errors.Join(err, rows.Close())
		if err != nil {
			return nil, false, err
		}
	}
	return entries, len(pairs) > 0, nil
}
