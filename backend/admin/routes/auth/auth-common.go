package auth

import (
	"context"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"

	"admin/utils/common"
	"admin/utils/dbs"
	"admin/utils/mail"
)

func Change_password(c *fiber.Ctx) error {
	db, err := dbs.OpenDB()
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer db.Close()

	user := c.FormValue("uname_or_email")
	common.WriteLog("Trying change password for %s", user)

	var username, mail_addr string = "", ""
	err = db.QueryRow("SELECT username, email FROM users WHERE username=$1 OR email=$2", user, user).Scan(&username, &mail_addr)
	if err != nil || len(mail_addr) <= 3 {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	redis, err := dbs.NewRedisClient(context.Background())
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer redis.Close()

	word, err := common.HashPassword(strconv.Itoa(time.Time.Nanosecond(time.Now())))
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	word = "psw" + strings.ReplaceAll(word, "/", "")
	common.WriteLog("Generate link %s for %s", word, username)
	err = redis.SetEx(context.Background(), word, username, time.Hour*1).Err()
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	common.WriteLog("Sending message for %s", mail_addr)
	link := os.Getenv("DOMAIN_PREF") + "/admit/" + word
	go mail.SendMail(
		mail_addr,
		"Change password",
		mail.GetLinkMailBody("change password", link),
	)
	return c.SendStatus(200)
}

func Confirm_password_change(c *fiber.Ctx) error {
	redis, err := dbs.NewRedisClient(context.Background())
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer redis.Close()

	word := c.FormValue("word")
	common.WriteLog("Processing link %s", word)
	var user string = ""
	user, err = redis.Get(context.Background(), word).Result()
	if err != nil || len(user) <= 3 {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	common.WriteLog("Changing password for %s", user)

	db, err := dbs.OpenDB()
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer db.Close()

	hashed_password, err := common.HashPassword(c.FormValue("password"))
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	err = db.QueryRow("UPDATE users SEt hashed_password=$1 WHERE username=$2", hashed_password, user).Err()
	if err != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	redis.Del(context.Background(), word)

	return c.SendStatus(200)
}

func Renew_token(c *fiber.Ctx) error {
	db, err := dbs.OpenDB()
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer db.Close()

	user := c.Locals("user").(*jwt.Token)
	claims := user.Claims.(jwt.MapClaims)
	name := claims["name"].(string)
	role := claims["role"].(string)

	var exists bool
	err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE username=$1 OR role=$2)", name, role).Scan(&exists)
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	if !exists {
		return c.SendStatus(fiber.StatusNotFound)
	}

	t, err := common.GetToken(name, role)
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	return c.JSON(fiber.Map{"token": t})
}
