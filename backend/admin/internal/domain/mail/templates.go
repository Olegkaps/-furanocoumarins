package mail

import "fmt"

func LinkBody(action, link string) string {
	return fmt.Sprintf(
		`<!DOCTYPE html><html><body><p>To %s, follow the <a href="%s">link</a>.</p><p>This link works for only 1 hour.</p></body></html>`,
		action, link,
	)
}

func LoginLink(domainPrefix, token string) Message {
	link := domainPrefix + "/admit/" + token
	return Message{
		Subject: "Login to site",
		Body:    LinkBody("log in", link),
		HTML:    true,
	}
}

func PasswordChangeLink(domainPrefix, token string) Message {
	link := domainPrefix + "/admit/" + token
	return Message{
		Subject: "Change password",
		Body:    LinkBody("change password", link),
		HTML:    true,
	}
}
