package mail_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	domainmail "admin/internal/domain/mail"
)

func TestLinkBodyPositive(t *testing.T) {
	body := domainmail.LinkBody("log in", "https://x/y")
	assert.Contains(t, body, "log in")
	assert.Contains(t, body, "https://x/y")
}

func TestLinkBodyNegativeEmptyAction(t *testing.T) {
	body := domainmail.LinkBody("", "https://x/y")
	assert.Contains(t, body, "To , follow")
}

func TestLoginLinkPositive(t *testing.T) {
	msg := domainmail.LoginLink("https://site", "tok")
	assert.Equal(t, "Login to site", msg.Subject)
	assert.Contains(t, msg.Body, "/admit/tok")
}

func TestPasswordChangeLinkPositive(t *testing.T) {
	msg := domainmail.PasswordChangeLink("https://site", "tok")
	assert.Equal(t, "Change password", msg.Subject)
	assert.Contains(t, msg.Body, "/admit/tok")
}

func TestPasswordChangeLinkNegativeEmptyDomain(t *testing.T) {
	msg := domainmail.PasswordChangeLink("", "tok")
	assert.Contains(t, msg.Body, "/admit/tok")
}
