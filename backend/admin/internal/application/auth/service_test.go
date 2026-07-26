package auth_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	appauth "admin/internal/application/auth"
	domainauth "admin/internal/domain/auth"
	domainmail "admin/internal/domain/mail"
	domainuser "admin/internal/domain/user"
	inframailmemory "admin/internal/infrastructure/mail/memory"
	inframemory "admin/internal/infrastructure/persistence/memory"
	"admin/internal/infrastructure/security"
)

type stubHasher struct {
	hash   string
	verify func(password, hash string) bool
}

func (s stubHasher) Hash(password string) (string, error) {
	if s.hash != "" {
		return s.hash, nil
	}
	return "hashed-" + password, nil
}

func (s stubHasher) HashWithPrefix(prefix string) stubHasher {
	return stubHasher{
		hash: prefix + "token",
		verify: s.verify,
	}
}

func (s stubHasher) Verify(password, hash string) bool {
	if s.verify != nil {
		return s.verify(password, hash)
	}
	return hash == "hashed-"+password
}

type stubTokens struct {
	token string
}

func (s stubTokens) Issue(username, role string) (string, error) {
	if s.token != "" {
		return s.token, nil
	}
	return username + ":" + role, nil
}

func newTestService(t *testing.T, users domainuser.Repository) (*appauth.Service, *inframailmemory.Sender) {
	t.Helper()
	mailSender := inframailmemory.NewSender()
	hasher := security.PasswordHasher{}
	svc := appauth.NewService(
		users,
		inframemory.NewMagicLinkStore(),
		mailSender,
		hasher,
		stubTokens{token: "jwt-token"},
		"https://example.com",
	).WithClock(func() time.Time {
		return time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	})
	return svc, mailSender
}

func TestServiceLoginPositive(t *testing.T) {
	hashed, err := security.PasswordHasher{}.Hash("secret")
	require.NoError(t, err)

	users := inframemory.NewUserRepository(domainuser.User{
		Username:       "alice",
		Email:          "alice@example.com",
		Role:           "admin",
		HashedPassword: hashed,
	})
	svc, _ := newTestService(t, users)

	token, err := svc.Login(context.Background(), "alice", "secret")
	require.NoError(t, err)
	assert.Equal(t, "jwt-token", token)
}

func TestServiceLoginNegativeWrongPassword(t *testing.T) {
	hashed, err := security.PasswordHasher{}.Hash("secret")
	require.NoError(t, err)

	users := inframemory.NewUserRepository(domainuser.User{
		Username:       "alice",
		Email:          "alice@example.com",
		Role:           "admin",
		HashedPassword: hashed,
	})
	svc, _ := newTestService(t, users)

	_, err = svc.Login(context.Background(), "alice", "wrong")
	assert.ErrorIs(t, err, appauth.ErrWrongPassword)
}

func TestServiceLoginByEmailWrongPassword(t *testing.T) {
	hashed, err := security.PasswordHasher{}.Hash("secret")
	require.NoError(t, err)

	users := inframemory.NewUserRepository(domainuser.User{
		Username: "alice", Email: "alice@example.com", Role: "admin", HashedPassword: hashed,
	})
	svc, _ := newTestService(t, users)

	_, err = svc.Login(context.Background(), "alice@example.com", "wrong")
	assert.ErrorIs(t, err, appauth.ErrWrongPassword)
}

func TestServiceRequestLoginLinkPositive(t *testing.T) {
	users := inframemory.NewUserRepository(domainuser.User{
		Username: "alice",
		Email:    "alice@example.com",
		Role:     "admin",
	})
	svc, mailSender := newTestService(t, users)

	err := svc.RequestLoginLink(context.Background(), "alice@example.com")
	require.NoError(t, err)
	require.Len(t, mailSender.Messages, 1)
	assert.Equal(t, "alice@example.com", mailSender.Messages[0].To)
	assert.Contains(t, mailSender.Messages[0].Body, "https://example.com/admit/")
}

func TestServiceConfirmLoginLinkPositive(t *testing.T) {
	links := inframemory.NewMagicLinkStore()
	require.NoError(t, links.Save(context.Background(), "lin123", "alice", time.Hour))

	svc := appauth.NewService(
		inframemory.NewUserRepository(),
		links,
		inframailmemory.NewSender(),
		stubHasher{},
		stubTokens{token: "renewed"},
		"https://example.com",
	)

	token, err := svc.ConfirmLoginLink(context.Background(), "lin123")
	require.NoError(t, err)
	assert.Equal(t, "renewed", token)

	_, err = svc.ConfirmLoginLink(context.Background(), "lin123")
	assert.ErrorIs(t, err, appauth.ErrInvalidToken)
}

func TestServiceConfirmPasswordChangeNegativeInvalidToken(t *testing.T) {
	svc := appauth.NewService(
		inframemory.NewUserRepository(),
		inframemory.NewMagicLinkStore(),
		inframailmemory.NewSender(),
		security.PasswordHasher{},
		stubTokens{},
		"https://example.com",
	)
	err := svc.ConfirmPasswordChange(context.Background(), "bad", "new-pass")
	assert.ErrorIs(t, err, appauth.ErrInvalidToken)
}

func TestServiceConfirmLoginLinkNegativeInvalidToken(t *testing.T) {
	svc, _ := newTestService(t, inframemory.NewUserRepository())
	_, err := svc.ConfirmLoginLink(context.Background(), "missing")
	assert.ErrorIs(t, err, appauth.ErrInvalidToken)
}

func TestServiceRequestPasswordChangePositive(t *testing.T) {
	users := inframemory.NewUserRepository(domainuser.User{
		Username: "bob",
		Email:    "bob@example.com",
		Role:     "admin",
	})
	svc, mailSender := newTestService(t, users)

	err := svc.RequestPasswordChange(context.Background(), "bob")
	require.NoError(t, err)
	require.Len(t, mailSender.Messages, 1)
	assert.Equal(t, "Change password", mailSender.Messages[0].Subject)
}

func TestServiceConfirmPasswordChangePositive(t *testing.T) {
	links := inframemory.NewMagicLinkStore()
	require.NoError(t, links.Save(context.Background(), "psw123", "bob", time.Hour))

	users := inframemory.NewUserRepository(domainuser.User{
		Username:       "bob",
		Email:          "bob@example.com",
		Role:           "admin",
		HashedPassword: "old",
	})

	svc := appauth.NewService(
		users,
		links,
		inframailmemory.NewSender(),
		security.PasswordHasher{},
		stubTokens{},
		"https://example.com",
	)

	err := svc.ConfirmPasswordChange(context.Background(), "psw123", "new-pass")
	require.NoError(t, err)

	updated, err := users.FindByLoginOrEmail(context.Background(), "bob")
	require.NoError(t, err)
	assert.True(t, security.PasswordHasher{}.Verify("new-pass", updated.HashedPassword))
}

func TestServiceRenewTokenPositive(t *testing.T) {
	users := inframemory.NewUserRepository(domainuser.User{
		Username: "alice",
		Email:    "alice@example.com",
		Role:     "admin",
	})
	svc, _ := newTestService(t, users)

	token, err := svc.RenewToken(context.Background(), "alice", "admin")
	require.NoError(t, err)
	assert.Equal(t, "jwt-token", token)
}

func TestServiceRenewTokenMissingUser(t *testing.T) {
	svc, _ := newTestService(t, inframemory.NewUserRepository())

	_, err := svc.RenewToken(context.Background(), "ghost", "admin")
	assert.ErrorIs(t, err, appauth.ErrInvalidCredentials)
}

func TestMagicLinkStoreConsumeExpired(t *testing.T) {
	store := inframemory.NewMagicLinkStore()
	require.NoError(t, store.Save(context.Background(), "expired", "alice", -time.Second))

	_, err := store.Consume(context.Background(), "expired")
	assert.ErrorIs(t, err, domainauth.ErrTokenNotFound)
}

func TestMailTemplates(t *testing.T) {
	msg := domainmail.LoginLink("https://site", "abc")
	assert.Equal(t, "Login to site", msg.Subject)
	assert.Contains(t, msg.Body, "https://site/admit/abc")
}

func TestServiceLoginUserNotFound(t *testing.T) {
	svc, _ := newTestService(t, inframemory.NewUserRepository())
	_, err := svc.Login(context.Background(), "ghost", "pass")
	assert.ErrorIs(t, err, appauth.ErrUserNotFound)
}

func TestServiceRequestLoginLinkInvalidUser(t *testing.T) {
	svc, _ := newTestService(t, inframemory.NewUserRepository())
	err := svc.RequestLoginLink(context.Background(), "ghost")
	assert.ErrorIs(t, err, appauth.ErrInvalidCredentials)
}

func TestServiceConfirmPasswordChangeNegativeHashError(t *testing.T) {
	links := inframemory.NewMagicLinkStore()
	require.NoError(t, links.Save(context.Background(), "psw123", "bob", time.Hour))

	svc := appauth.NewService(
		inframemory.NewUserRepository(domainuser.User{Username: "bob", Role: "admin"}),
		links,
		inframailmemory.NewSender(),
		hashErrorHasher{},
		stubTokens{},
		"https://example.com",
	)

	err := svc.ConfirmPasswordChange(context.Background(), "psw123", "new-pass")
	require.Error(t, err)
}

func TestServiceGenerateTokenFormat(t *testing.T) {
	users := inframemory.NewUserRepository(domainuser.User{
		Username: "alice", Email: "alice@example.com", Role: "admin",
	})
	mailSender := inframailmemory.NewSender()
	svc := appauth.NewService(
		users,
		inframemory.NewMagicLinkStore(),
		mailSender,
		stubHasher{},
		stubTokens{},
		"https://example.com",
	)

	err := svc.RequestLoginLink(context.Background(), "alice@example.com")
	require.NoError(t, err)
	require.Len(t, mailSender.Messages, 1)
	assert.Contains(t, mailSender.Messages[0].Body, "https://example.com/admit/lin")
	assert.NotContains(t, mailSender.Messages[0].Body, "/admit/linlin")
}

type hashErrorHasher struct{}

func (hashErrorHasher) Hash(string) (string, error) { return "", assert.AnError }
func (hashErrorHasher) Verify(string, string) bool  { return false }

func TestServiceRenewTokenNegativeRepoError(t *testing.T) {
	users := errorUserRepo{err: assert.AnError}
	svc := appauth.NewService(
		users,
		inframemory.NewMagicLinkStore(),
		inframailmemory.NewSender(),
		stubHasher{},
		stubTokens{},
		"https://example.com",
	)
	_, err := svc.RenewToken(context.Background(), "alice", "admin")
	require.Error(t, err)
}

func TestServiceRequestPasswordChangeUserNotFound(t *testing.T) {
	svc, _ := newTestService(t, inframemory.NewUserRepository())
	err := svc.RequestPasswordChange(context.Background(), "ghost")
	assert.ErrorIs(t, err, appauth.ErrUserNotFound)
}

type errorUserRepo struct {
	err error
}

func (e errorUserRepo) FindByLoginOrEmail(context.Context, string) (*domainuser.User, error) {
	return nil, e.err
}
func (e errorUserRepo) UpdatePassword(context.Context, string, string) error { return e.err }
func (e errorUserRepo) ExistsWithRole(context.Context, string, string) (bool, error) {
	return false, e.err
}

type errorLinkStore struct {
	saveErr    error
	consumeErr error
}

func (e errorLinkStore) Save(context.Context, string, string, time.Duration) error {
	return e.saveErr
}

func (e errorLinkStore) Consume(context.Context, string) (string, error) {
	return "", e.consumeErr
}

type errorMailSender struct{ err error }

func (e errorMailSender) Send(context.Context, domainmail.Message) error { return e.err }

func TestServiceRequestLoginLinkNegativeSaveError(t *testing.T) {
	users := inframemory.NewUserRepository(domainuser.User{
		Username: "alice", Email: "alice@example.com", Role: "admin",
	})
	svc := appauth.NewService(
		users,
		errorLinkStore{saveErr: assert.AnError},
		inframailmemory.NewSender(),
		stubHasher{},
		stubTokens{},
		"https://example.com",
	)
	err := svc.RequestLoginLink(context.Background(), "alice")
	require.Error(t, err)
}

func TestServiceRequestLoginLinkNegativeMailError(t *testing.T) {
	users := inframemory.NewUserRepository(domainuser.User{
		Username: "alice", Email: "alice@example.com", Role: "admin",
	})
	svc := appauth.NewService(
		users,
		inframemory.NewMagicLinkStore(),
		errorMailSender{err: assert.AnError},
		stubHasher{},
		stubTokens{},
		"https://example.com",
	)
	err := svc.RequestLoginLink(context.Background(), "alice")
	require.Error(t, err)
}

func TestServiceRequestPasswordChangeNegativeSaveError(t *testing.T) {
	users := inframemory.NewUserRepository(domainuser.User{
		Username: "bob", Email: "bob@example.com", Role: "admin",
	})
	svc := appauth.NewService(
		users,
		errorLinkStore{saveErr: assert.AnError},
		inframailmemory.NewSender(),
		stubHasher{},
		stubTokens{},
		"https://example.com",
	)
	err := svc.RequestPasswordChange(context.Background(), "bob")
	require.Error(t, err)
}

func TestServiceRequestPasswordChangeNegativeMailError(t *testing.T) {
	users := inframemory.NewUserRepository(domainuser.User{
		Username: "bob", Email: "bob@example.com", Role: "admin",
	})
	svc := appauth.NewService(
		users,
		inframemory.NewMagicLinkStore(),
		errorMailSender{err: assert.AnError},
		stubHasher{},
		stubTokens{},
		"https://example.com",
	)
	err := svc.RequestPasswordChange(context.Background(), "bob")
	require.Error(t, err)
}

func TestServiceConfirmLoginLinkNegativeConsumeError(t *testing.T) {
	svc := appauth.NewService(
		inframemory.NewUserRepository(),
		errorLinkStore{consumeErr: assert.AnError},
		inframailmemory.NewSender(),
		stubHasher{},
		stubTokens{},
		"https://example.com",
	)
	_, err := svc.ConfirmLoginLink(context.Background(), "lin123")
	require.Error(t, err)
	assert.False(t, errors.Is(err, appauth.ErrInvalidToken))
}

func TestServiceConfirmPasswordChangeNegativeUpdateError(t *testing.T) {
	links := inframemory.NewMagicLinkStore()
	require.NoError(t, links.Save(context.Background(), "psw123", "bob", time.Hour))

	svc := appauth.NewService(
		errorUserRepo{err: assert.AnError},
		links,
		inframailmemory.NewSender(),
		security.PasswordHasher{},
		stubTokens{},
		"https://example.com",
	)
	err := svc.ConfirmPasswordChange(context.Background(), "psw123", "new-pass")
	require.Error(t, err)
}

func TestServiceRenewTokenNegativeIssueError(t *testing.T) {
	users := inframemory.NewUserRepository(domainuser.User{
		Username: "alice", Email: "alice@example.com", Role: "admin",
	})
	svc := appauth.NewService(
		users,
		inframemory.NewMagicLinkStore(),
		inframailmemory.NewSender(),
		stubHasher{},
		errorTokenIssuer{},
		"https://example.com",
	)
	_, err := svc.RenewToken(context.Background(), "alice", "admin")
	require.Error(t, err)
}

type errorTokenIssuer struct{}

func (errorTokenIssuer) Issue(string, string) (string, error) { return "", assert.AnError }
