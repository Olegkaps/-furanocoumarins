package postgres

import (
	"admin/utils/common"
	"admin/utils/dbs"
	"admin/utils/logging"

	"github.com/gofiber/fiber/v2"
)

type User struct {
	Username        string
	Mail            string
	Role            string
	Hashed_password string
}

func GetUser(c *fiber.Ctx, mail_or_login string) (*User, error) {
	logging.Info(c, "trying to get user %s", mail_or_login)

	var u User
	err := dbs.DB.QueryRow(
		"SELECT username, email, role, hashed_password FROM users WHERE username=$1 OR email=$2",
		mail_or_login, mail_or_login,
	).Scan(&u.Username, &u.Mail, &u.Role, &u.Hashed_password)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func UserExists(c *fiber.Ctx, mail_or_login string, role string) (bool, error) {
	logging.Info(c, "is user exists %s", mail_or_login)

	var exists bool
	err := dbs.DB.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM users WHERE (username=$1 OR email=$2) AND role=$3)",
		mail_or_login, mail_or_login, role,
	).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

func Change_password(c *fiber.Ctx, username string, password string) error {
	logging.Info(c, "changing password for %s", username)

	hashed_password, err := common.HashPassword(password)
	if err != nil {
		return err
	}
	err = dbs.DB.QueryRow("UPDATE users SET hashed_password=$1 WHERE username=$2", hashed_password, username).Err()

	return nil
}
