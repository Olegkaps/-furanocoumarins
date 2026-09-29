package cassandra

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"admin/internal/autocomplete"
	"admin/internal/chemistry"
	"admin/internal/pkg/metadata"
	"admin/internal/presentation/http/response"
)

// A persisted generation makes bibliography invalidation work across replicas.
// Dataset identity is read on every request; immutable imports need no TTL.
func (s *Store) autocompleteVersion(ctx context.Context) (string, string, string, error) {
	var data, meta, key string
	err := s.db.QueryRowContext(ctx, `SELECT table_data,table_meta,created_at::text || ':' || version || ':' || (SELECT generation::text FROM chemdb.autocomplete_generation WHERE id=1) FROM chemdb.tables WHERE is_active AND is_ok`).Scan(&data, &meta, &key)
	return data, meta, key, err
}
func (s *Store) Autocomplete(ctx context.Context, value string, columns []string, limit int, searchScope ...bool) ([]autocomplete.Suggestion, error) {
	return s.withAutocomplete(ctx, columns, func(ctx context.Context, index *autocomplete.Index) ([]autocomplete.Suggestion, error) {
		if len(searchScope) > 0 && searchScope[0] {
			var err error
			columns, err = index.SearchColumns(columns)
			if err != nil {
				return nil, &response.UserError{E: err}
			}
			if len(columns) == 0 {
				return []autocomplete.Suggestion{}, nil
			}
		}
		return index.Search(ctx, value, columns, limit)
	})
}
func (s *Store) StructureAutocomplete(ctx context.Context, value string, columns []string, limit int, opts chemistry.Options, searchScope ...bool) ([]autocomplete.Suggestion, error) {
	return s.searchStructures(ctx, value, columns, limit, opts, len(searchScope) > 0 && searchScope[0], "")
}

func (s *Store) withAutocomplete(ctx context.Context, columns []string, search func(context.Context, *autocomplete.Index) ([]autocomplete.Suggestion, error)) ([]autocomplete.Suggestion, error) {
	return s.withAutocompleteDataset(ctx, columns, "", search)
}
func (s *Store) withAutocompleteDataset(ctx context.Context, columns []string, expectedData string, search func(context.Context, *autocomplete.Index) ([]autocomplete.Suggestion, error)) ([]autocomplete.Suggestion, error) {
	if s.db == nil {
		return nil, ErrNotConfigured
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	data, _, key, err := s.autocompleteVersion(ctx)
	if err != nil {
		return nil, err
	}
	if expectedData != "" && data != expectedData {
		return nil, chemistry.ErrBusy
	}
	s.autocompleteMu.RLock()
	if s.autocompleteIndex == nil || s.autocompleteKey != key {
		s.autocompleteMu.RUnlock()
		s.WarmAutocomplete()
		return nil, chemistry.ErrBusy
	}
	defer s.autocompleteMu.RUnlock()
	if err = s.autocompleteIndex.ValidateColumns(columns); err != nil {
		return nil, &response.UserError{E: err}
	}
	result, err := search(ctx, s.autocompleteIndex)
	if err != nil {
		return nil, err
	}
	_, _, current, err := s.autocompleteVersion(ctx)
	if err != nil {
		return nil, err
	}
	if current != key || s.autocompleteKey != key {
		return nil, fmt.Errorf("active autocomplete data changed; retry: %w", chemistry.ErrBusy)
	}
	return result, nil
}

// WarmAutocomplete prepares the active dataset without tying the rebuild to an
// HTTP deadline. Imports retain only the latest inactive dataset alongside it.
// The channel closes when queued work drains; build failures are logged.
func (s *Store) WarmAutocomplete() <-chan struct{} { return s.scheduleAutocomplete(nil) }

func (s *Store) scheduleAutocomplete(stamp *time.Time) <-chan struct{} {
	if s.db == nil {
		done := make(chan struct{})
		close(done)
		return done
	}
	s.autocompleteMu.Lock()
	defer s.autocompleteMu.Unlock()
	if s.autocompleteClosed {
		done := make(chan struct{})
		close(done)
		return done
	}
	if stamp == nil {
		s.autocompleteActivePending = true
	} else {
		copy := *stamp
		s.autocompletePending = &copy
	}
	if s.autocompleteDone != nil {
		return s.autocompleteDone
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.autocompleteCancel = cancel
	s.autocompleteDone = make(chan struct{})
	go s.buildAutocomplete(ctx)
	return s.autocompleteDone
}

func (s *Store) buildAutocomplete(ctx context.Context) {
	for {
		s.autocompleteMu.Lock()
		stamp := s.autocompletePending
		s.autocompletePending = nil
		active := s.autocompleteActivePending
		if stamp == nil {
			s.autocompleteActivePending = false
		}
		if s.autocompleteClosed || (stamp == nil && !active) {
			close(s.autocompleteDone)
			s.autocompleteDone = nil
			s.autocompleteCancel = nil
			s.autocompleteMu.Unlock()
			return
		}
		s.autocompleteMu.Unlock()
		started := time.Now()
		buildCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
		err := s.prepareAutocomplete(buildCtx, stamp)
		cancel()
		if err != nil && !errors.Is(err, sql.ErrNoRows) && !errors.Is(err, context.Canceled) {
			log.Printf("autocomplete build failed dataset=%v after %s: %v", stamp, time.Since(started), err)
		}
	}
}

func (s *Store) autocompleteTarget(ctx context.Context, stamp *time.Time) (string, string, string, error) {
	if stamp == nil {
		return s.autocompleteVersion(ctx)
	}
	var data, meta, key string
	err := s.db.QueryRowContext(ctx, `SELECT table_data,table_meta,created_at::text || ':' || version || ':' || (SELECT generation::text FROM chemdb.autocomplete_generation WHERE id=1) FROM chemdb.tables WHERE created_at=$1 AND is_ok`, *stamp).Scan(&data, &meta, &key)
	return data, meta, key, err
}

func (s *Store) prepareAutocomplete(ctx context.Context, stamp *time.Time) error {
	data, meta, key, err := s.autocompleteTarget(ctx, stamp)
	if err != nil {
		return err
	}
	s.autocompleteMu.Lock()
	if s.autocompleteKey == key && s.autocompleteIndex != nil {
		s.autocompleteMu.Unlock()
		return nil
	}
	index := s.autocompletePrepared
	if s.autocompletePreparedKey == key && index != nil {
		s.autocompletePrepared = nil
	} else {
		index = nil
	}
	s.autocompleteMu.Unlock()
	if index == nil {
		entries, columns, err := s.autocompleteEntries(ctx, data, meta)
		if err != nil {
			return err
		}
		index, err = autocomplete.New(ctx, entries, columns)
		if err != nil {
			return err
		}
	}
	_, _, current, err := s.autocompleteTarget(ctx, stamp)
	if err != nil || current != key {
		_ = index.Close()
		if err != nil {
			return err
		}
		s.WarmAutocomplete()
		return chemistry.ErrBusy
	}
	_, _, active, err := s.autocompleteVersion(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		_ = index.Close()
		return err
	}
	s.autocompleteMu.Lock()
	defer s.autocompleteMu.Unlock()
	if s.autocompleteClosed {
		return index.Close()
	}
	if active == key {
		if s.autocompleteIndex != nil {
			_ = s.autocompleteIndex.Close()
		}
		s.autocompleteIndex, s.autocompleteKey = index, key
	} else {
		if s.autocompletePrepared != nil {
			_ = s.autocompletePrepared.Close()
		}
		s.autocompletePrepared, s.autocompletePreparedKey = index, key
		if stamp == nil {
			s.autocompleteActivePending = true
		}
	}
	return nil
}

func (s *Store) autocompleteEntries(ctx context.Context, data, meta string) ([]autocomplete.Entry, []string, error) {
	dataName, err := pgTable(data)
	if err != nil {
		return nil, nil, err
	}
	metaName, err := pgTable(meta)
	if err != nil {
		return nil, nil, err
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `SELECT "column",show_name,type FROM `+metaName+` ORDER BY "column"`)
	if err != nil {
		return nil, nil, err
	}
	var metas []autocomplete.Suggestion
	var columns []string
	for rows.Next() {
		var m autocomplete.Suggestion
		if err = rows.Scan(&m.Column, &m.ShowName, &m.Type); err != nil {
			return nil, nil, errors.Join(err, rows.Close())
		}
		if m.ShowName == "" {
			m.ShowName = m.Column
		}
		m.Group = autocompleteGroup(m.Type)
		metas = append(metas, m)
		columns = append(columns, m.Column)
	}
	err = errors.Join(rows.Err(), rows.Close())
	if err != nil {
		return nil, nil, err
	}
	bibliography := map[string]string{}
	rows, err = tx.QueryContext(ctx, `SELECT article_id,bibtex_text FROM chemdb.bibtex`)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var id, text string
		if err = rows.Scan(&id, &text); err != nil {
			return nil, nil, errors.Join(err, rows.Close())
		}
		bibliography[id] = bibtexSearchText(text)
	}
	err = errors.Join(rows.Err(), rows.Close())
	if err != nil {
		return nil, nil, err
	}
	entries := []autocomplete.Entry{}
	seen := map[string]bool{}
	for _, m := range metas {
		col, err := pgColumn(m.Column)
		if err != nil {
			return nil, nil, err
		}
		// to_jsonb handles both text and text[] without confusing commas/braces in
		// actual values with PostgreSQL's array serialization syntax.
		rows, err = tx.QueryContext(ctx, `SELECT DISTINCT member.value FROM `+dataName+` CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(to_jsonb(`+col+`))='array' THEN to_jsonb(`+col+`) ELSE jsonb_build_array(`+col+`) END) member(value) WHERE member.value IS NOT NULL AND member.value <> '' ORDER BY 1`)
		if err != nil {
			return nil, nil, err
		}
		for rows.Next() {
			var value string
			if err = rows.Scan(&value); err != nil {
				return nil, nil, errors.Join(err, rows.Close())
			}
			if len(value) > 16384 {
				return nil, nil, errors.Join(fmt.Errorf("autocomplete value exceeds 16 KiB"), rows.Close())
			}
			values := []string{value}
			if metadata.IsChemicalNameList(m.Column, m.Type) {
				values = metadata.ChemicalNames(value)
			}
			for _, value := range values {
				key := m.Column + "\x00" + value
				if seen[key] {
					continue
				}
				seen[key] = true
				e := autocomplete.Entry{Suggestion: m}
				e.Value = value
				if strings.Contains(m.Type, "ref[") {
					e.Text = bibliography[value]
				}
				entries = append(entries, e)
				if len(entries) > 1000000 {
					return nil, nil, errors.Join(fmt.Errorf("autocomplete exceeds one million distinct values"), rows.Close())
				}
			}
		}
		err = errors.Join(rows.Err(), rows.Close())
		if err != nil {
			return nil, nil, err
		}
	}
	combined, enabled, err := classificationAutocompleteEntries(ctx, tx, dataName, metas, 1000000-len(entries))
	if err != nil {
		return nil, nil, err
	}
	if enabled {
		columns = append(columns, classificationAutocompleteColumn)
	}
	entries = append(entries, combined...)
	return entries, columns, tx.Commit()
}
func autocompleteGroup(t string) string {
	tokens := strings.Fields(t)
	for _, token := range tokens {
		if token == "specie" || token == "table_specie" || strings.HasPrefix(token, "clas[") {
			return "species"
		}
	}
	for _, token := range tokens {
		if token == "chemical" || token == "table_chemical" || strings.EqualFold(token, "smiles") {
			return "chemicals"
		}
	}
	for _, token := range tokens {
		if strings.HasPrefix(token, "ref[") || token == "publication" {
			return "publications"
		}
	}
	return "observations"
}

// CloseAutocomplete releases the disposable index during application shutdown.
func (s *Store) CloseAutocomplete() error {
	s.autocompleteMu.Lock()
	s.autocompleteClosed = true
	done := s.autocompleteDone
	if s.autocompleteCancel != nil {
		s.autocompleteCancel()
	}
	s.autocompleteMu.Unlock()
	if done != nil {
		<-done
	}
	s.autocompleteMu.Lock()
	defer s.autocompleteMu.Unlock()
	var err error
	if s.autocompleteIndex != nil {
		err = s.autocompleteIndex.Close()
	}
	if s.autocompletePrepared != nil {
		err = errors.Join(err, s.autocompletePrepared.Close())
	}
	s.autocompleteIndex = nil
	s.autocompletePrepared = nil
	return err
}
