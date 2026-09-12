package cassandrapostgres

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

type source struct {
	tables     []Table
	copied     int
	bib, pages int
	tablesErr  error
}

func (s *source) Tables(context.Context) ([]Table, error) { return s.tables, s.tablesErr }
func (s *source) CopyTable(context.Context, Table) error  { s.copied++; return nil }
func (s *source) CopyBibtex(context.Context) error        { s.bib++; return nil }
func (s *source) CopyPages(context.Context) error         { s.pages++; return nil }

type target struct {
	done      map[string]Table
	active    string
	unlockErr error
	unlocked  int
}

func (t *target) Lock(context.Context) (func() error, error) {
	return func() error { t.unlocked++; return t.unlockErr }, nil
}
func (t *target) Manifest(_ context.Context, id string) (Table, bool, error) {
	x, ok := t.done[id]
	return x, ok, nil
}
func (t *target) PutManifest(_ context.Context, x Table) error { t.done[x.ID] = x; return nil }
func (t *target) SetActive(_ context.Context, id string) error { t.active = id; return nil }
func (t *target) Validate(context.Context, Table) error        { return nil }
func TestRunCopiesValidatesAndIsIdempotent(t *testing.T) {
	s := &source{tables: []Table{{ID: "v1", Checksum: "a", Rows: 2, Active: true}}}
	d := &target{done: map[string]Table{}}
	require.NoError(t, Run(context.Background(), s, d))
	require.Equal(t, 1, s.copied)
	require.Equal(t, "v1", d.active)
	require.NoError(t, Run(context.Background(), s, d))
	require.Equal(t, 1, s.copied)
}
func TestRunRejectsManifestConflict(t *testing.T) {
	s := &source{tables: []Table{{ID: "v1", Checksum: "new", Rows: 2}}}
	d := &target{done: map[string]Table{"v1": {ID: "v1", Checksum: "old", Rows: 2}}}
	require.Error(t, Run(context.Background(), s, d))
}
func TestRunRejectsMultipleActive(t *testing.T) {
	s := &source{tables: []Table{{ID: "a", Checksum: "a"}, {ID: "b", Checksum: "b", Active: true}, {ID: "c", Checksum: "c", Active: true}}}
	d := &target{done: map[string]Table{}}
	require.Error(t, Run(context.Background(), s, d))
}

func TestRunReleasesLockAndPreservesErrors(t *testing.T) {
	readErr := errors.New("registry unavailable")
	unlockErr := errors.New("unlock failed")
	for _, tc := range []struct {
		name         string
		read, unlock error
	}{
		{name: "success"},
		{name: "registry failure", read: readErr},
		{name: "unlock failure", unlock: unlockErr},
		{name: "both failures", read: readErr, unlock: unlockErr},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &source{tablesErr: tc.read}
			d := &target{unlockErr: tc.unlock}
			err := Run(context.Background(), s, d)
			require.Equal(t, 1, d.unlocked)
			if tc.read == nil && tc.unlock == nil {
				require.NoError(t, err)
			}
			if tc.read != nil {
				require.ErrorIs(t, err, tc.read)
			}
			if tc.unlock != nil {
				require.ErrorIs(t, err, tc.unlock)
			}
		})
	}
}
