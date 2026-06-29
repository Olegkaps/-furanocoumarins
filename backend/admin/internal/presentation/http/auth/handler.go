package auth

import (
	"errors"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"

	appauth "admin/internal/application/auth"
	"admin/internal/app"
	"admin/internal/presentation/http/response"
)

type Handler struct {
	svc *appauth.Service
}

func NewHandler(container *app.Container) *Handler {
	return &Handler{svc: container.Auth}
}

// Login godoc
// @Summary      Login with username/email and password
// @Description  Returns JWT token on success
// @Tags         auth
// @Accept       x-www-form-urlencoded
// @Param        uname_or_email formData string true "Username or email"
// @Param        password formData string true "Password"
// @Produce      json
// @Success      200 {object} response.TokenResponse
// @Failure      401,500 {object} response.ErrorResponse
// @Router       /auth/login [post]
func (h *Handler) Login(c *fiber.Ctx) error {
	token, err := h.svc.Login(c.Context(), c.FormValue("uname_or_email"), c.FormValue("password"))
	if err != nil {
		if errors.Is(err, appauth.ErrWrongPassword) || errors.Is(err, appauth.ErrUserNotFound) {
			return response.Resp401(c, err)
		}
		return response.Resp500(c, err)
	}
	return response.JSON(c, response.TokenResponse{Token: token})
}

// Login_mail godoc
// @Summary      Request login link by email
// @Description  Sends a magic link to user email for passwordless login
// @Tags         auth
// @Accept       x-www-form-urlencoded
// @Param        uname_or_email formData string true "Username or email"
// @Success      200
// @Failure      401,500 {object} response.ErrorResponse
// @Router       /auth/login-mail [post]
func (h *Handler) Login_mail(c *fiber.Ctx) error {
	err := h.svc.RequestLoginLink(c.Context(), c.FormValue("uname_or_email"))
	if err != nil {
		if errors.Is(err, appauth.ErrInvalidCredentials) {
			return response.Resp401(c, err)
		}
		return response.Resp500(c, err)
	}
	return response.Resp200(c)
}

// Confirm_login_mail godoc
// @Summary      Confirm login via magic link
// @Description  Exchanges word from email link for JWT token
// @Tags         auth
// @Accept       x-www-form-urlencoded
// @Param        word formData string true "Token from email link"
// @Produce      json
// @Success      200 {object} response.TokenResponse
// @Failure      401,500 {object} response.ErrorResponse
// @Router       /auth/confirm-login-mail [post]
func (h *Handler) Confirm_login_mail(c *fiber.Ctx) error {
	token, err := h.svc.ConfirmLoginLink(c.Context(), c.FormValue("word"))
	if err != nil {
		if errors.Is(err, appauth.ErrInvalidToken) {
			return response.Resp401(c, err)
		}
		return response.Resp500(c, err)
	}
	return response.JSON(c, response.TokenResponse{Token: token})
}

// Change_password godoc
// @Summary      Request password change
// @Description  Sends password reset link to user email
// @Tags         auth
// @Accept       x-www-form-urlencoded
// @Param        uname_or_email formData string true "Username or email"
// @Success      200
// @Failure      400,500 {object} response.ErrorResponse
// @Router       /auth/change-password [post]
func (h *Handler) Change_password(c *fiber.Ctx) error {
	err := h.svc.RequestPasswordChange(c.Context(), c.FormValue("uname_or_email"))
	if err != nil {
		if errors.Is(err, appauth.ErrUserNotFound) {
			return response.Resp400(c, err)
		}
		return response.Resp500(c, err)
	}
	return response.Resp200(c)
}

// Confirm_password_change godoc
// @Summary      Confirm password change
// @Description  Sets new password using token from email link
// @Tags         auth
// @Accept       x-www-form-urlencoded
// @Param        word formData string true "Token from email link"
// @Param        password formData string true "New password"
// @Success      200
// @Failure      400,401 {object} response.ErrorResponse
// @Router       /auth/confirm-password-change [post]
func (h *Handler) Confirm_password_change(c *fiber.Ctx) error {
	err := h.svc.ConfirmPasswordChange(c.Context(), c.FormValue("word"), c.FormValue("password"))
	if err != nil {
		if errors.Is(err, appauth.ErrInvalidToken) {
			return response.Resp401(c, err)
		}
		return response.Resp400(c, err)
	}
	return response.Resp200(c)
}

// Renew_token godoc
// @Summary      Renew JWT token
// @Description  Returns new JWT token for authenticated user
// @Tags         auth
// @Security     BearerAuth
// @Produce      json
// @Success      200 {object} response.TokenResponse
// @Failure      401,500 {object} response.ErrorResponse
// @Router       /auth/renew-token [post]
func (h *Handler) Renew_token(c *fiber.Ctx) error {
	user := c.Locals("user").(*jwt.Token)
	claims := user.Claims.(jwt.MapClaims)
	name := claims["name"].(string)
	role := claims["role"].(string)

	token, err := h.svc.RenewToken(c.Context(), name, role)
	if err != nil {
		if errors.Is(err, appauth.ErrInvalidCredentials) {
			return response.Resp401(c, err)
		}
		return response.Resp500(c, err)
	}
	return response.JSON(c, response.TokenResponse{Token: token})
}
