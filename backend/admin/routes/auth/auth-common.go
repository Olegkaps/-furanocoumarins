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
	"admin/utils/logging"
	"admin/utils/mail"
)

// Change_password godoc
// @Summary      Request password change
// @Description  Sends password reset link to user email
// @Tags         auth
// @Accept       x-www-form-urlencoded
// @Param        uname_or_email formData string true "Username or email"
// @Success      200
// @Failure      400,500 {object} http.ErrorResponse
// @Router       /auth/change-password [post]
func Change_password(c *fiber.Ctx) error {
	mail_or_login := c.FormValue("uname_or_email")

	user, err := postgres.GetUser(c, mail_or_login)
	if err != nil {
		return http.Resp400(c, err)
	}

	word, err := common.HashPassword(strconv.Itoa(time.Time.Nanosecond(time.Now())))
	if err != nil {
		return http.Resp500(c, err)
	}

	word = "psw" + strings.ReplaceAll(word, "/", "")
	logging.Info(c, "Generate link %s for %s", word, user.Username)
	err = dbs.Redis.SetEx(context.Background(), word, user.Username, time.Hour*1).Err()
	if err != nil {
		return http.Resp500(c, err)
	}

	link := settings.DOMAIN_PREF + "/admit/" + word
	err = mail.SendMail(
		c, user.Mail,
		"Change password",
		mail.GetLinkMailBody("change password", link),
	)
	if err != nil {
		return http.Resp500(c, err)
	}
	return http.Resp200(c)
}

// Confirm_password_change godoc
// @Summary      Confirm password change
// @Description  Sets new password using token from email link
// @Tags         auth
// @Accept       x-www-form-urlencoded
// @Param        word formData string true "Token from email link"
// @Param        password formData string true "New password"
// @Success      200
// @Failure      400,401 {object} http.ErrorResponse
// @Router       /auth/confirm-password-change [post]
func Confirm_password_change(c *fiber.Ctx) error {
	word := c.FormValue("word")
	logging.Info(c, "Processing link %s", word)

	user, err := dbs.Redis.Get(context.Background(), word).Result()
	if err != nil {
		return http.Resp401(c, err)
	}
	logging.Info(c, "Changing password for %s", user)

	err = postgres.Change_password(c, user, c.FormValue("password"))
	if err != nil {
		return http.Resp400(c, err)
	}

	dbs.Redis.Del(context.Background(), word)

	return http.Resp200(c)
}

// Renew_token godoc
// @Summary      Renew JWT token
// @Description  Returns new JWT token for authenticated user
// @Tags         auth
// @Security     BearerAuth
// @Produce      json
// @Success      200 {object} http.TokenResponse
// @Failure      401,500 {object} http.ErrorResponse
// @Router       /auth/renew-token [post]
func Renew_token(c *fiber.Ctx) error {
	user := c.Locals("user").(*jwt.Token)
	claims := user.Claims.(jwt.MapClaims)
	name := claims["name"].(string)
	role := claims["role"].(string)

	exists, err := postgres.UserExists(c, name, role)
	if err != nil {
		return http.Resp500(c, err)
	}
	if !exists {
		return http.Resp401(c, nil)
	}

	t, err := common.GetToken(c, name, role)
	if err != nil {
		return http.Resp500(c, err)
	}

	return http.JSON(c, http.TokenResponse{Token: t})
}
