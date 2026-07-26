package smtp

import (
	"context"
	"fmt"
	"net/smtp"
	"strings"

	domainmail "admin/internal/domain/mail"
	"admin/settings"
)

type Config struct {
	Host        string
	Port        string
	SenderEmail string
	Password    string
}

func ConfigFromSettings() Config {
	return Config{
		Host:        settings.C.SmtpHost,
		Port:        settings.C.SmtpPort,
		SenderEmail: settings.C.Mail,
		Password:    settings.C.MailSecret,
	}
}

// Sender is the SMTP adapter implementing the mail outbound port.
type Sender struct {
	cfg Config
}

func NewSender(cfg Config) *Sender {
	return &Sender{cfg: cfg}
}

func (s *Sender) Send(_ context.Context, msg domainmail.Message) error {
	auth := smtp.PlainAuth("", s.cfg.SenderEmail, s.cfg.Password, s.cfg.Host)
	body := buildEmailBody(s.cfg.SenderEmail, msg)

	err := smtp.SendMail(
		s.cfg.Host+":"+s.cfg.Port,
		auth,
		s.cfg.SenderEmail,
		[]string{msg.To},
		body,
	)
	if err != nil {
		return fmt.Errorf("send email: %w", err)
	}
	return nil
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
