package smtp

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	domainmail "admin/internal/domain/mail"
)

func TestBuildEmailBodyPlainText(t *testing.T) {
	body := buildEmailBody("sender@example.com", domainmail.Message{
		To:      "user@example.com",
		Subject: "Hello",
		Body:    "Plain body",
	})

	text := string(body)
	assert.Contains(t, text, "From: sender@example.com")
	assert.Contains(t, text, "To: user@example.com")
	assert.Contains(t, text, "Subject: Hello")
	assert.Contains(t, text, "Content-Type: text/plain; charset=UTF-8")
	assert.Contains(t, text, "Plain body")
	assert.NotContains(t, text, "text/html")
}

func TestBuildEmailBodyHTML(t *testing.T) {
	body := buildEmailBody("sender@example.com", domainmail.Message{
		To:      "user@example.com",
		Subject: "Login",
		Body:    `<p><a href="https://site/admit/tok">link</a></p>`,
		HTML:    true,
	})

	text := string(body)
	assert.Contains(t, text, "Content-Type: text/html; charset=UTF-8")
	assert.Contains(t, text, `<a href="https://site/admit/tok">link</a>`)
	require.True(t, strings.HasSuffix(text, `</p>`))
}
