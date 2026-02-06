package mail

import (
	"admin/utils/logging"
	"fmt"
	"net/smtp"
	"os"

	"github.com/gofiber/fiber/v2"
)

func GetLinkMailBody(action string, link string) string {
	return fmt.Sprintf("To %s, follow the <a href=\"%s\">link</a>\nThis link works for only 1 hour.", action, link)
}

var smtpServer = "smtp.yandex.ru"
var smtpPort = "587"
var senderEmail = os.Getenv("MAIL")
var mailSecret = os.Getenv("MAIL_SECRET")

func SendMail(c *fiber.Ctx, recivier, subject, body string) error {
	logging.Info(c, "sending mail to %s", recivier)

	auth := smtp.PlainAuth("", senderEmail, mailSecret, smtpServer)

	// Create the email message
	msg := "From: " + senderEmail + "\n" +
		"To: " + recivier + "\n" +
		"Subject: " + subject + "\n\n" +
		body

	// Send the email
	err := smtp.SendMail(smtpServer+":"+smtpPort, auth, senderEmail, []string{recivier}, []byte(msg))
	if err != nil {
		return fmt.Errorf("failed to send email: %v", err)
	}

	return nil
}
