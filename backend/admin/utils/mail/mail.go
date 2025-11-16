package mail

import (
	"fmt"
	"net/smtp"
	"os"
)

func GetLinkMailBody(action string, link string) string {
	return fmt.Sprintf("To %s, follow the <a href=\"%s\">link</a>\nThis link works for only 1 hour.", action, link)
}

func SendMail(recivier, subject, body string) error {
	smtpServer := "smtp.yandex.ru"
	smtpPort := "587"
	senderEmail := os.Getenv("MAIL")

	auth := smtp.PlainAuth("", senderEmail, os.Getenv("MAIL_SECRET"), smtpServer)

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
