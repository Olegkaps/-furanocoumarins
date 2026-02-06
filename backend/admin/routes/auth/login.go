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
	"admin/utils/mail"
)

func Login(c *fiber.Ctx) error {
	login_or_email := c.FormValue("uname_or_email")
	password := c.FormValue("password")

	db_user, err := postgres.GetUser(login_or_email)
	if err != nil {
		return http.Resp400(c, err)
	}

	if !common.CheckPasswordHash(password, db_user.Hashed_password) {
		return http.Resp401(c)
	}

	t, err := common.GetToken(db_user.Username, db_user.Role)
	if err != nil {
		return http.Resp500(c, err)
	}

	return c.JSON(fiber.Map{"token": t})
}

func Login_mail(c *fiber.Ctx) error {
	mail_or_login := c.FormValue("uname_or_email")

	user, err := postgres.GetUser(mail_or_login)
	if err != nil {
		return http.Resp400(c, err)
	}

	word, err := common.HashPassword(strconv.Itoa(time.Time.Nanosecond(time.Now())))
	if err != nil {
		return http.Resp500(c, err)
	}

	word = "lin" + strings.ReplaceAll(word, "/", "")
	word = "lin" + strings.ReplaceAll(word, ".", "")
	common.WriteLog("Generate link %s for %s", word, user.Username)

	err = dbs.Redis.SetEx(context.Background(), word, user.Username, time.Hour*1).Err()
	if err != nil {
		return http.Resp500(c, err)
	}

	link := settings.DOMAIN_PREF + "/admit/" + word
	go mail.SendMail(
		user.Mail,
		"Login to site",
		mail.GetLinkMailBody("log in", link),
	)
	return c.SendStatus(200)
}

func Confirm_login_mail(c *fiber.Ctx) error {
	word := c.FormValue("word")
	common.WriteLog("Processing link %s", word)
	var user string = ""

	user, err := dbs.Redis.Get(context.Background(), word).Result()
	if err != nil || len(user) <= 3 {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	dbs.Redis.Del(context.Background(), word)

	t, err := common.GetToken(user, "admin")
	if err != nil {
		return http.Resp500(c, err)
	}

	return c.JSON(fiber.Map{"token": t})
}
