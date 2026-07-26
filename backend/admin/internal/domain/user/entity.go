package user

// User is the domain aggregate for authentication and authorization.
type User struct {
	Username       string
	Email          string
	Role           string
	HashedPassword string
}

func (u *User) CanAuthenticateWith(password string, verify func(password, hash string) bool) bool {
	return verify(password, u.HashedPassword)
}
