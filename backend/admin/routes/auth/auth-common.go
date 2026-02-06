package auth

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"

	"admin/settings"
	"admin/utils/common"
	"admin/utils/dbs"
	"admin/utils/dbs/postgres"
	"admin/utils/http"
	"admin/utils/mail"
)

func Change_password(c *fiber.Ctx) error {
	mail_or_login := c.FormValue("uname_or_email")

	user, err := postgres.GetUser(mail_or_login)
	if err != nil {
		return http.Resp400(c, err)
	}

	word, err := common.HashPassword(strconv.Itoa(time.Time.Nanosecond(time.Now())))
	if err != nil {
		return http.Resp500(c, err)
	}

	word = "psw" + strings.ReplaceAll(word, "/", "")
	common.WriteLog("Generate link %s for %s", word, user.Username)
	err = dbs.Redis.SetEx(context.Background(), word, user.Username, time.Hour*1).Err()
	if err != nil {
		return http.Resp500(c, err)
	}

	link := settings.DOMAIN_PREF + "/admit/" + word
	go mail.SendMail(
		user.Mail,
		"Change password",
		mail.GetLinkMailBody("change password", link),
	)
	return c.SendStatus(200)
}

func Confirm_password_change(c *fiber.Ctx) error {
	word := c.FormValue("word")
	common.WriteLog("Processing link %s", word)
	var user string = ""

	user, err := dbs.Redis.Get(context.Background(), word).Result()
	if err != nil || len(user) <= 3 {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	common.WriteLog("Changing password for %s", user)

	err = postgres.Change_password(user, c.FormValue("password"))
	if err != nil {
		return http.Resp400(c, err)
	}

	dbs.Redis.Del(context.Background(), word)

	return c.SendStatus(200)
}

func Renew_token(c *fiber.Ctx) error {
	user := c.Locals("user").(*jwt.Token)
	claims := user.Claims.(jwt.MapClaims)
	name := claims["name"].(string)
	role := claims["role"].(string)

	exists, err := postgres.UserExists(name, role)
	if err != nil {
		return http.Resp500(c, err)
	}
	if !exists {
		return http.Resp401(c)
	}

	t, err := common.GetToken(name, role)
	if err != nil {
		return http.Resp500(c, err)
	}

	return c.JSON(fiber.Map{"token": t})
}
