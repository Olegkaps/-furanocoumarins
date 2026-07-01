package mail

import "fmt"

func LinkBody(action, link string) string {
	return fmt.Sprintf(
		"To %s, follow the <a href=\"%s\">link</a>\nThis link works for only 1 hour.",
		action, link,
	)
}

func LoginLink(domainPrefix, token string) Message {
	link := domainPrefix + "/admit/" + token
	return Message{
		Subject: "Login to site",
		Body:    LinkBody("log in", link),
	}
}

func PasswordChangeLink(domainPrefix, token string) Message {
	link := domainPrefix + "/admit/" + token
	return Message{
		Subject: "Change password",
		Body:    LinkBody("change password", link),
	}
}
