package auth

import (
	"errors"

	"github.com/gofiber/fiber/v2"

	appauth "admin/internal/application/auth"
	"admin/internal/app"
	"admin/internal/presentation/http/deps"
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
// @Param        uname_or_email formData string true "Username or email" example(admin@example.com) example(admin)
// @Param        password formData string true "Password" example(secret)
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

// LoginMail godoc
// @Summary      Request login link by email
// @Description  Sends a magic link to user email for passwordless login
// @Tags         auth
// @Accept       x-www-form-urlencoded
// @Param        uname_or_email formData string true "Username or email" example(admin@example.com)
// @Success      200
// @Failure      401,500 {object} response.ErrorResponse
// @Router       /auth/login-mail [post]
func (h *Handler) LoginMail(c *fiber.Ctx) error {
	err := h.svc.RequestLoginLink(c.Context(), c.FormValue("uname_or_email"))
	if err != nil {
		if errors.Is(err, appauth.ErrInvalidCredentials) {
			return response.Resp401(c, err)
		}
		return response.Resp500(c, err)
	}
	return response.Resp200(c)
}

// ConfirmLoginMail godoc
// @Summary      Confirm login via magic link
// @Description  Exchanges word from email link for JWT token
// @Tags         auth
// @Accept       x-www-form-urlencoded
// @Param        word formData string true "Token from email link" example(linAbCdEf123)
// @Produce      json
// @Success      200 {object} response.TokenResponse
// @Failure      401,500 {object} response.ErrorResponse
// @Router       /auth/confirm-login-mail [post]
func (h *Handler) ConfirmLoginMail(c *fiber.Ctx) error {
	token, err := h.svc.ConfirmLoginLink(c.Context(), c.FormValue("word"))
	if err != nil {
		if errors.Is(err, appauth.ErrInvalidToken) {
			return response.Resp401(c, err)
		}
		return response.Resp500(c, err)
	}
	return response.JSON(c, response.TokenResponse{Token: token})
}

// ChangePassword godoc
// @Summary      Request password change
// @Description  Sends password reset link to user email
// @Tags         auth
// @Accept       x-www-form-urlencoded
// @Param        uname_or_email formData string true "Username or email" example(admin@example.com)
// @Success      200
// @Failure      400,500 {object} response.ErrorResponse
// @Router       /auth/change-password [post]
func (h *Handler) ChangePassword(c *fiber.Ctx) error {
	err := h.svc.RequestPasswordChange(c.Context(), c.FormValue("uname_or_email"))
	if err != nil {
		if errors.Is(err, appauth.ErrUserNotFound) {
			return response.Resp400(c, err)
		}
		return response.Resp500(c, err)
	}
	return response.Resp200(c)
}

// ConfirmPasswordChange godoc
// @Summary      Confirm password change
// @Description  Sets new password using token from email link
// @Tags         auth
// @Accept       x-www-form-urlencoded
// @Param        word formData string true "Token from email link" example(pswXyZ987)
// @Param        password formData string true "New password" example(new-secret)
// @Success      200
// @Failure      400,401 {object} response.ErrorResponse
// @Router       /auth/confirm-password-change [post]
func (h *Handler) ConfirmPasswordChange(c *fiber.Ctx) error {
	err := h.svc.ConfirmPasswordChange(c.Context(), c.FormValue("word"), c.FormValue("password"))
	if err != nil {
		if errors.Is(err, appauth.ErrInvalidToken) {
			return response.Resp401(c, err)
		}
		return response.Resp400(c, err)
	}
	return response.Resp200(c)
}

// RenewToken godoc
// @Summary      Renew JWT token
// @Description  Returns new JWT token for authenticated user
// @Tags         auth
// @Security     BearerAuth
// @Produce      json
// @Success      200 {object} response.TokenResponse
// @Failure      401,500 {object} response.ErrorResponse
// @Router       /auth/renew-token [post]
func (h *Handler) RenewToken(c *fiber.Ctx) error {
	name, err := deps.JWTUsername(c)
	if err != nil {
		return response.Resp401(c, err)
	}
	role, err := deps.JWTRole(c)
	if err != nil {
		return response.Resp401(c, err)
	}

	token, err := h.svc.RenewToken(c.Context(), name, role)
	if err != nil {
		if errors.Is(err, appauth.ErrInvalidCredentials) {
			return response.Resp401(c, err)
		}
		return response.Resp500(c, err)
	}
	return response.JSON(c, response.TokenResponse{Token: token})
}
