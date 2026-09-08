package smtp

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"

	domainmail "admin/internal/domain/mail"
	"admin/settings"
)

type Config struct {
	Host        string
	Port        string
	SenderEmail string
	Password    string
	Timeout     time.Duration
}

func ConfigFromSettings() Config {
	return Config{
		Host:        settings.C.SmtpHost,
		Port:        settings.C.SmtpPort,
		SenderEmail: settings.C.Mail,
		Password:    settings.C.MailSecret,
		Timeout:     settings.C.SmtpTimeout,
	}
}

// Sender is the SMTP adapter implementing the mail outbound port.
type Sender struct {
	cfg Config
}

func NewSender(cfg Config) *Sender {
	return &Sender{cfg: cfg}
}

func (s *Sender) Send(ctx context.Context, msg domainmail.Message) error {
	timeout := s.cfg.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	addr := net.JoinHostPort(s.cfg.Host, s.cfg.Port)
	body := buildEmailBody(s.cfg.SenderEmail, msg)
	conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", addr)
	if err != nil {
		return smtpStageError(ctx, "connect")
	}
	defer conn.Close()
	deadline := time.Now().Add(timeout)
	if ctxDeadline, ok := ctx.Deadline(); ok && ctxDeadline.Before(deadline) {
		deadline = ctxDeadline
	}
	if err := conn.SetDeadline(deadline); err != nil {
		return errors.New("smtp deadline failed")
	}
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.SetDeadline(time.Now())
		case <-done:
		}
	}()
	defer close(done)

	client, err := smtp.NewClient(conn, s.cfg.Host)
	if err != nil {
		return smtpStageError(ctx, "greeting")
	}
	defer client.Close()
	if ok, _ := client.Extension("STARTTLS"); ok {
		if err := client.StartTLS(&tls.Config{MinVersion: tls.VersionTLS12, ServerName: s.cfg.Host}); err != nil {
			return smtpStageError(ctx, "starttls")
		}
	}
	if s.cfg.SenderEmail != "" && s.cfg.Password != "" {
		if ok, _ := client.Extension("AUTH"); !ok {
			return errors.New("smtp authentication unavailable")
		}
		if err := client.Auth(smtp.PlainAuth("", s.cfg.SenderEmail, s.cfg.Password, s.cfg.Host)); err != nil {
			return smtpStageError(ctx, "authentication")
		}
	}
	if err := client.Mail(s.cfg.SenderEmail); err != nil {
		return smtpStageError(ctx, "sender")
	}
	if err := client.Rcpt(msg.To); err != nil {
		return smtpStageError(ctx, "recipient")
	}
	w, err := client.Data()
	if err != nil {
		return smtpStageError(ctx, "data")
	}
	if _, err := w.Write(body); err != nil {
		_ = w.Close()
		return smtpStageError(ctx, "body")
	}
	if err := w.Close(); err != nil {
		return smtpStageError(ctx, "acceptance")
	}
	// DATA's final 250 is delivery acceptance; do not wait for QUIT.
	return nil
}

func smtpStageError(ctx context.Context, stage string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return fmt.Errorf("smtp %s failed", stage)
}

func buildEmailBody(senderEmail string, msg domainmail.Message) []byte {
	contentType := "text/plain; charset=UTF-8"
	if msg.HTML {
		contentType = "text/html; charset=UTF-8"
	}

	var sb strings.Builder
	sb.WriteString("From: ")
	sb.WriteString(senderEmail)
	sb.WriteString("\r\nTo: ")
	sb.WriteString(msg.To)
	sb.WriteString("\r\nSubject: ")
	sb.WriteString(msg.Subject)
	sb.WriteString("\r\nMIME-Version: 1.0\r\nContent-Type: ")
	sb.WriteString(contentType)
	sb.WriteString("\r\n\r\n")
	sb.WriteString(msg.Body)
	return []byte(sb.String())
}

var _ domainmail.Sender = (*Sender)(nil)
