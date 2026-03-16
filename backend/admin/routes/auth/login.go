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

// Login godoc
// @Summary      Login with username/email and password
// @Description  Returns JWT token on success
// @Tags         auth
// @Accept       x-www-form-urlencoded
// @Param        uname_or_email formData string true "Username or email"
// @Param        password formData string true "Password"
// @Produce      json
// @Success      200 {object} http.TokenResponse
// @Failure      401,500 {object} http.ErrorResponse
// @Router       /auth/login [post]
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

	return http.JSON(c, http.TokenResponse{Token: t})
}

// Login_mail godoc
// @Summary      Request login link by email
// @Description  Sends a magic link to user email for passwordless login
// @Tags         auth
// @Accept       x-www-form-urlencoded
// @Param        uname_or_email formData string true "Username or email"
// @Success      200
// @Failure      401,500 {object} http.ErrorResponse
// @Router       /auth/login-mail [post]
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
	err = mail.SendMail(
		c, user.Mail,
		"Login to site",
		mail.GetLinkMailBody("log in", link),
	)
	if err != nil {
		return http.Resp500(c, err)
	}
	return http.Resp200(c)
}

// Confirm_login_mail godoc
// @Summary      Confirm login via magic link
// @Description  Exchanges word from email link for JWT token
// @Tags         auth
// @Accept       x-www-form-urlencoded
// @Param        word formData string true "Token from email link"
// @Produce      json
// @Success      200 {object} http.TokenResponse
// @Failure      401,500 {object} http.ErrorResponse
// @Router       /auth/confirm-login-mail [post]
func Confirm_login_mail(c *fiber.Ctx) error {
	word := c.FormValue("word")
	logging.Info(c, "Processing link %s", word)

	user, err := dbs.Redis.Get(context.Background(), word).Result()
	if err != nil {
		return http.Resp401(c, err)
	}

	dbs.Redis.Del(context.Background(), word)

	t, err := common.GetToken(c, user, "admin")
	if err != nil {
		return http.Resp500(c, err)
	}

	return http.JSON(c, http.TokenResponse{Token: t})
}
