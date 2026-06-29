package smtp

import (
	"context"
	"fmt"
	"net/smtp"
	"os"

	domainmail "admin/internal/domain/mail"
)

type Config struct {
	Host        string
	Port        string
	SenderEmail string
	Password    string
}

func ConfigFromEnv() Config {
	return Config{
		Host:        envOrDefault("SMTP_HOST", "smtp.yandex.ru"),
		Port:        envOrDefault("SMTP_PORT", "587"),
		SenderEmail: os.Getenv("MAIL"),
		Password:    os.Getenv("MAIL_SECRET"),
	}
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
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
	body := "From: " + s.cfg.SenderEmail + "\n" +
		"To: " + msg.To + "\n" +
		"Subject: " + msg.Subject + "\n\n" +
		msg.Body

	err := smtp.SendMail(
		s.cfg.Host+":"+s.cfg.Port,
		auth,
		s.cfg.SenderEmail,
		[]string{msg.To},
		[]byte(body),
	)
	if err != nil {
		return fmt.Errorf("send email: %w", err)
	}
	return nil
}

var _ domainmail.Sender = (*Sender)(nil)
