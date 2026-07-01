package user

import "context"

// Repository is the outbound port for user persistence (DDD repository).
type Repository interface {
	FindByLoginOrEmail(ctx context.Context, loginOrEmail string) (*User, error)
	ExistsWithRole(ctx context.Context, loginOrEmail, role string) (bool, error)
	UpdatePassword(ctx context.Context, username, hashedPassword string) error
}
