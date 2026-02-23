package auth

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"admin/settings"
	"admin/utils/common"
	"admin/utils/dbs"
	"admin/utils/dbs/postgres"
	"admin/utils/http"
	"admin/utils/logging"
	"admin/utils/mail"
)

func Login(c *fiber.Ctx) error {
	login_or_email := c.FormValue("uname_or_email")
	password := c.FormValue("password")

	db_user, err := postgres.GetUser(c, login_or_email)
	if err != nil {
		return http.Resp401(c, err)
	}

	if !common.CheckPasswordHash(password, db_user.Hashed_password) {
		return http.Resp401(c, nil)
	}

	t, err := common.GetToken(c, db_user.Username, db_user.Role)
	if err != nil {
		return http.Resp500(c, err)
	}

	return http.JSON(c, fiber.Map{"token": t})
}

func Login_mail(c *fiber.Ctx) error {
	mail_or_login := c.FormValue("uname_or_email")

	user, err := postgres.GetUser(c, mail_or_login)
	if err != nil {
		return http.Resp401(c, err)
	}

	word, err := common.HashPassword(strconv.Itoa(time.Time.Nanosecond(time.Now())))
	if err != nil {
		return http.Resp500(c, err)
	}

	word = "lin" + strings.ReplaceAll(word, "/", "")
	word = "lin" + strings.ReplaceAll(word, ".", "")
	logging.Info(c, "Generate link %s for %s", word, user.Username)

	err = dbs.Redis.SetEx(context.Background(), word, user.Username, time.Hour*1).Err()
	if err != nil {
		return http.Resp500(c, err)
	}

	link := settings.DOMAIN_PREF + "/admit/" + word
	mail.SendMail(
		c, user.Mail,
		"Login to site",
		mail.GetLinkMailBody("log in", link),
	)
	return http.Resp200(c)
}

func Confirm_login_mail(c *fiber.Ctx) error {
	word := c.FormValue("word")
	logging.Info(c, "Processing link %s", word)
	var user string = ""

	user, err := dbs.Redis.Get(context.Background(), word).Result()
	if err != nil {
		return http.Resp401(c, err)
	}

	dbs.Redis.Del(context.Background(), word)

	t, err := common.GetToken(c, user, "admin")
	if err != nil {
		return http.Resp500(c, err)
	}

	return http.JSON(c, fiber.Map{"token": t})
}
