package authmaster

import (
	"context"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestNormalizeUsersCanonicalizesSelectsAndKeepsStableIDs(t *testing.T) {
	input := []SourceUser{
		{SourceID: 1, Role: " ADMIN ", Login: " Alice ", Email: "Alice@Example.Test"},
		{SourceID: 2, Role: "user", Login: "bob", Email: "BOB@example.test"},
	}
	rows, selected, err := normalizeUsers(input, " ALICE@example.test ")
	require.NoError(t, err)
	require.Equal(t, "alice", rows[0].Login)
	require.Equal(t, "alice@example.test", rows[0].Email)
	require.Equal(t, rows[0].ID, selected)
	repeated, repeatedSelected, err := normalizeUsers(input, "alice")
	require.NoError(t, err)
	require.Equal(t, rows[0].ID, repeated[0].ID)
	require.Equal(t, selected, repeatedSelected)
}

func TestNormalizeUsersRejectsCollisionsInvalidRolesAndDuplicateSourceIDsWithoutIdentityLeak(t *testing.T) {
	const privateIdentity = "private.selected@example.test"
	tests := []struct {
		name     string
		users    []SourceUser
		selector string
		want     string
	}{
		{
			name: "cross-field collision",
			users: []SourceUser{
				{SourceID: 41, Role: "admin", Login: "owner", Email: privateIdentity},
				{SourceID: 99, Role: "user", Login: " PRIVATE.SELECTED@example.test ", Email: "second@example.test"},
			},
			selector: privateIdentity, want: "normalized identity collision between source users 41 and 99",
		},
		{name: "unsupported role", users: []SourceUser{{SourceID: 1, Role: "owner", Login: "alice", Email: privateIdentity}}, selector: "alice", want: "unsupported role"},
		{name: "duplicate source id", users: []SourceUser{{SourceID: 1, Role: "admin", Login: "alice", Email: privateIdentity}, {SourceID: 1, Role: "user", Login: "bob", Email: "bob@example.test"}}, selector: "alice", want: "duplicated"},
		{name: "unmatched selector", users: []SourceUser{{SourceID: 1, Role: "admin", Login: "alice", Email: "alice@example.test"}}, selector: privateIdentity, want: "matched 0 source users"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := normalizeUsers(tc.users, tc.selector)
			require.ErrorContains(t, err, tc.want)
			require.NotContains(t, strings.ToLower(err.Error()), privateIdentity)
		})
	}
}

func TestPreflightTargetSchemaRequiresInitializedAuthMasterSchema(t *testing.T) {
	for _, tc := range []struct {
		name string
		row  *sqlmock.Rows
		ok   bool
	}{
		{name: "compatible", row: sqlmock.NewRows([]string{"users", "roles", "memberships", "keys", "canonical", "key_trigger", "columns", "enums", "membership_unique"}).AddRow(true, true, true, true, true, true, true, true, true), ok: true},
		{name: "uninitialized", row: sqlmock.NewRows([]string{"users", "roles", "memberships", "keys", "canonical", "key_trigger", "columns", "enums", "membership_unique"}).AddRow(false, false, false, false, false, false, false, false, false)},
		{name: "wrong columns", row: sqlmock.NewRows([]string{"users", "roles", "memberships", "keys", "canonical", "key_trigger", "columns", "enums", "membership_unique"}).AddRow(true, true, true, true, true, true, false, true, true)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			defer db.Close()
			mock.ExpectQuery(regexp.QuoteMeta("SELECT")).WillReturnRows(tc.row)
			err = PreflightTargetSchema(context.Background(), db)
			if tc.ok {
				require.NoError(t, err)
			} else {
				require.ErrorContains(t, err, "start the deployed authd image")
			}
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestReadSourceUsersQueryCannotReadLegacyPassword(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id, role, username, email FROM users ORDER BY id")).
		WillReturnRows(sqlmock.NewRows([]string{"id", "role", "username", "email"}).AddRow(7, "admin", "Mixed", "Mixed@Example.Test"))
	mock.ExpectCommit()
	users, err := ReadSourceUsers(context.Background(), db)
	require.NoError(t, err)
	require.Equal(t, []SourceUser{{SourceID: 7, Role: "admin", Login: "Mixed", Email: "Mixed@Example.Test"}}, users)
	require.NoError(t, mock.ExpectationsWereMet())
}
