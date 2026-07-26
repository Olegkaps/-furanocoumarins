package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"time"

	domainauth "admin/internal/domain/auth"
	domainmail "admin/internal/domain/mail"
	domainuser "admin/internal/domain/user"
)

type PasswordHasher interface {
	Hash(password string) (string, error)
	Verify(password, hash string) bool
}

type TokenIssuer interface {
	Issue(username, role string) (string, error)
}

type Service struct {
	users      domainuser.Repository
	links      domainauth.MagicLinkStore
	mail       domainmail.Sender
	hasher     PasswordHasher
	tokens     TokenIssuer
	domainPref string
	now        func() time.Time
}

func NewService(
	users domainuser.Repository,
	links domainauth.MagicLinkStore,
	mail domainmail.Sender,
	hasher PasswordHasher,
	tokens TokenIssuer,
	domainPref string,
) *Service {
	return &Service{
		users:      users,
		links:      links,
		mail:       mail,
		hasher:     hasher,
		tokens:     tokens,
		domainPref: domainPref,
		now:        time.Now,
	}
}

func (s *Service) WithClock(now func() time.Time) *Service {
	s.now = now
	return s
}

func (s *Service) Login(ctx context.Context, loginOrEmail, password string) (string, error) {
	u, err := s.users.FindByLoginOrEmail(ctx, loginOrEmail)
	if err != nil {
		return "", ErrUserNotFound
	}
	if !u.CanAuthenticateWith(password, s.hasher.Verify) {
		return "", ErrWrongPassword
	}
	return s.tokens.Issue(u.Username, u.Role)
}

func (s *Service) RequestLoginLink(ctx context.Context, loginOrEmail string) error {
	u, err := s.users.FindByLoginOrEmail(ctx, loginOrEmail)
	if err != nil {
		return ErrInvalidCredentials
	}

	token, err := s.generateToken("lin")
	if err != nil {
		return err
	}

	if err := s.links.Save(ctx, token, u.Username, time.Hour); err != nil {
		return err
	}

	msg := domainmail.LoginLink(s.domainPref, token)
	msg.To = u.Email
	return s.mail.Send(ctx, msg)
}

func (s *Service) ConfirmLoginLink(ctx context.Context, token string) (string, error) {
	username, err := s.links.Consume(ctx, token)
	if err != nil {
		if errors.Is(err, domainauth.ErrTokenNotFound) {
			return "", ErrInvalidToken
		}
		return "", err
	}
	return s.tokens.Issue(username, "admin")
}

func (s *Service) RequestPasswordChange(ctx context.Context, loginOrEmail string) error {
	u, err := s.users.FindByLoginOrEmail(ctx, loginOrEmail)
	if err != nil {
		return ErrUserNotFound
	}

	token, err := s.generateToken("psw")
	if err != nil {
		return err
	}

	if err := s.links.Save(ctx, token, u.Username, time.Hour); err != nil {
		return err
	}

	msg := domainmail.PasswordChangeLink(s.domainPref, token)
	msg.To = u.Email
	return s.mail.Send(ctx, msg)
}

func (s *Service) ConfirmPasswordChange(ctx context.Context, token, newPassword string) error {
	username, err := s.links.Consume(ctx, token)
	if err != nil {
		if errors.Is(err, domainauth.ErrTokenNotFound) {
			return ErrInvalidToken
		}
		return err
	}

	hashed, err := s.hasher.Hash(newPassword)
	if err != nil {
		return err
	}

	return s.users.UpdatePassword(ctx, username, hashed)
}

func (s *Service) RenewToken(ctx context.Context, username, role string) (string, error) {
	exists, err := s.users.ExistsWithRole(ctx, username, role)
	if err != nil {
		return "", err
	}
	if !exists {
		return "", ErrInvalidCredentials
	}
	return s.tokens.Issue(username, role)
}

func (s *Service) generateToken(prefix string) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return prefix + base64.RawURLEncoding.EncodeToString(b), nil
}
