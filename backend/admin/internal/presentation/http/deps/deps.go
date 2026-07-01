package deps

import (
	"context"

	"admin/internal/app"
	domainmail "admin/internal/domain/mail"
)

// Handler provides shared dependencies for HTTP handlers.
type Handler struct {
	Container *app.Container
}

func New(container *app.Container) Handler {
	return Handler{Container: container}
}

func (h Handler) SendMail(ctx context.Context, msg domainmail.Message) error {
	return h.Container.Mail.Send(ctx, msg)
}
