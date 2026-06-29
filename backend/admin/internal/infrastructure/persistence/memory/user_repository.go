package memory

import (
	"context"
	"errors"

	domainuser "admin/internal/domain/user"
)

var ErrNotFound = errors.New("user not found")

type UserRepository struct {
	users map[string]domainuser.User
}

func NewUserRepository(seed ...domainuser.User) *UserRepository {
	repo := &UserRepository{users: make(map[string]domainuser.User)}
	for _, u := range seed {
		repo.users[u.Username] = u
	}
	return repo
}

func (r *UserRepository) FindByLoginOrEmail(_ context.Context, loginOrEmail string) (*domainuser.User, error) {
	for _, u := range r.users {
		if u.Username == loginOrEmail || u.Email == loginOrEmail {
			copy := u
			return &copy, nil
		}
	}
	return nil, ErrNotFound
}

func (r *UserRepository) ExistsWithRole(_ context.Context, loginOrEmail, role string) (bool, error) {
	for _, u := range r.users {
		if (u.Username == loginOrEmail || u.Email == loginOrEmail) && u.Role == role {
			return true, nil
		}
	}
	return false, nil
}

func (r *UserRepository) UpdatePassword(_ context.Context, username, hashedPassword string) error {
	u, ok := r.users[username]
	if !ok {
		return ErrNotFound
	}
	u.HashedPassword = hashedPassword
	r.users[username] = u
	return nil
}

var _ domainuser.Repository = (*UserRepository)(nil)
