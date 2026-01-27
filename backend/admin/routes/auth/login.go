package auth

import (
	"context"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"admin/utils/common"
	"admin/utils/dbs"
	"admin/utils/mail"
)

func Login(c *fiber.Ctx) error {
	db, err := dbs.OpenDB()
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer db.Close()

	user := c.FormValue("uname_or_email")
	password := c.FormValue("password")
	common.WriteLog("Trying to log in %s", user)

	var username, role, hashed_password string
	err = db.QueryRow("SELECT username, role, hashed_password FROM users WHERE username=$1 OR email=$2", user, user).Scan(&username, &role, &hashed_password)
	if err != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	if !common.CheckPasswordHash(password, hashed_password) {
		return c.SendStatus(fiber.StatusUnauthorized)
	}

	t, err := common.GetToken(username, role)
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	return c.JSON(fiber.Map{"token": t})
}

func Login_mail(c *fiber.Ctx) error {
	db, err := dbs.OpenDB()
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer db.Close()

	user := c.FormValue("uname_or_email")
	common.WriteLog("Trying to log in %s by mail", user)

	var username, mail_addr string
	err = db.QueryRow("SELECT username, email FROM users WHERE username=$1 OR email=$2", user, user).Scan(&username, &mail_addr)
	if err != nil || len(mail_addr) <= 3 {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	common.WriteLog("user have name %s and email %s", username, mail_addr)

	redis, err := dbs.NewRedisClient(context.Background())
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer redis.Close()

	word, err := common.HashPassword(strconv.Itoa(time.Time.Nanosecond(time.Now())))
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	word = "lin" + strings.ReplaceAll(word, "/", "")
	word = "lin" + strings.ReplaceAll(word, ".", "")
	common.WriteLog("Generate link %s for %s", word, username)
	err = redis.SetEx(context.Background(), word, username, time.Hour*1).Err()
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	common.WriteLog("Sending message for %s", mail_addr)
	link := os.Getenv("DOMAIN_PREF") + "/admit/" + word
	go mail.SendMail(
		mail_addr,
		"Login to site",
		mail.GetLinkMailBody("log in", link),
	)
	return c.SendStatus(200)
}

func Confirm_login_mail(c *fiber.Ctx) error {
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

	redis.Del(context.Background(), word)

	t, err := common.GetToken(user, "admin")
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	return c.JSON(fiber.Map{"token": t})
}
