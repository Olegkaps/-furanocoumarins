package postgres

import (
	"context"
	"database/sql"

	domainuser "admin/internal/domain/user"
)

type UserRepository struct {
	db *sql.DB
}

func NewUserRepository(db *sql.DB) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) FindByLoginOrEmail(ctx context.Context, loginOrEmail string) (*domainuser.User, error) {
	var u domainuser.User
	err := r.db.QueryRowContext(ctx,
		"SELECT username, email, role, hashed_password FROM users WHERE username=$1 OR email=$2",
		loginOrEmail, loginOrEmail,
	).Scan(&u.Username, &u.Email, &u.Role, &u.HashedPassword)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *UserRepository) ExistsWithRole(ctx context.Context, loginOrEmail, role string) (bool, error) {
	var exists bool
	err := r.db.QueryRowContext(ctx,
		"SELECT EXISTS(SELECT 1 FROM users WHERE (username=$1 OR email=$2) AND role=$3)",
		loginOrEmail, loginOrEmail, role,
	).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

func (r *UserRepository) UpdatePassword(ctx context.Context, username, hashedPassword string) error {
	_, err := r.db.ExecContext(ctx,
		"UPDATE users SET hashed_password=$1 WHERE username=$2",
		hashedPassword, username,
	)
	return err
}
