package smtp

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

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

func TestSenderTimeoutCancellationAcceptanceAndRedaction(t *testing.T) {
	t.Run("blackhole greeting is bounded and redacted", func(t *testing.T) {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		require.NoError(t, err)
		defer listener.Close()
		accepted := make(chan net.Conn, 1)
		go func() {
			conn, acceptErr := listener.Accept()
			if acceptErr == nil {
				accepted <- conn
			}
		}()
		port := fmt.Sprintf("%d", listener.Addr().(*net.TCPAddr).Port)
		sender := NewSender(Config{Host: "127.0.0.1", Port: port, SenderEmail: "sender@example.test", Password: "secret-password", Timeout: 75 * time.Millisecond})
		err = sender.Send(context.Background(), domainmail.Message{To: "recipient@example.test", Subject: "secret subject", Body: "code 731905 secret body"})
		require.Error(t, err)
		for _, secret := range []string{"recipient@example.test", "731905", "secret body", "secret-password"} {
			require.NotContains(t, err.Error(), secret)
		}
		select {
		case conn := <-accepted:
			_ = conn.Close()
		default:
		}
	})

	t.Run("cancellation unblocks greeting", func(t *testing.T) {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		require.NoError(t, err)
		defer listener.Close()
		go func() {
			conn, acceptErr := listener.Accept()
			if acceptErr == nil {
				defer conn.Close()
				time.Sleep(time.Second)
			}
		}()
		port := fmt.Sprintf("%d", listener.Addr().(*net.TCPAddr).Port)
		sender := NewSender(Config{Host: "127.0.0.1", Port: port, SenderEmail: "sender@example.test", Timeout: time.Second})
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan error, 1)
		go func() {
			done <- sender.Send(ctx, domainmail.Message{To: "recipient@example.test", Subject: "s", Body: "b"})
		}()
		time.Sleep(20 * time.Millisecond)
		cancel()
		select {
		case sendErr := <-done:
			require.Error(t, sendErr)
		case <-time.After(500 * time.Millisecond):
			t.Fatal("context cancellation did not unblock SMTP")
		}
	})

	t.Run("returns after DATA acceptance without QUIT", func(t *testing.T) {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		require.NoError(t, err)
		defer listener.Close()
		postAcceptance := make(chan string, 1)
		serverErr := make(chan error, 1)
		go func() {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				serverErr <- acceptErr
				return
			}
			defer conn.Close()
			reader := bufio.NewReader(conn)
			_, _ = fmt.Fprint(conn, "220 test ESMTP\r\n")
			for _, response := range []string{"250-test\r\n250 HELP\r\n", "250 sender ok\r\n", "250 recipient ok\r\n", "354 data\r\n"} {
				if _, readErr := reader.ReadString('\n'); readErr != nil {
					serverErr <- readErr
					return
				}
				_, _ = fmt.Fprint(conn, response)
			}
			for {
				line, readErr := reader.ReadString('\n')
				if readErr != nil {
					serverErr <- readErr
					return
				}
				if line == ".\r\n" {
					break
				}
			}
			_, _ = fmt.Fprint(conn, "250 accepted\r\n")
			_ = conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
			line, _ := reader.ReadString('\n')
			postAcceptance <- line
		}()
		port := fmt.Sprintf("%d", listener.Addr().(*net.TCPAddr).Port)
		sender := NewSender(Config{Host: "127.0.0.1", Port: port, SenderEmail: "sender@example.test", Timeout: time.Second})
		require.NoError(t, sender.Send(context.Background(), domainmail.Message{To: "recipient@example.test", Subject: "s", Body: "b"}))
		select {
		case err := <-serverErr:
			t.Fatal(err)
		case command := <-postAcceptance:
			require.Empty(t, command)
		case <-time.After(time.Second):
			t.Fatal("SMTP server did not observe close")
		}
	})
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
