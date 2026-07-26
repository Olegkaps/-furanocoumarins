package memory_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	domainmail "admin/internal/domain/mail"
	inframailmemory "admin/internal/infrastructure/mail/memory"
)

func TestMailSenderSendPositive(t *testing.T) {
	sender := inframailmemory.NewSender()
	err := sender.Send(context.Background(), domainmail.Message{
		To: "user@example.com", Subject: "hello", Body: "world",
	})
	require.NoError(t, err)
	require.Len(t, sender.Messages, 1)
}

func TestMailSenderSendMultiplePositive(t *testing.T) {
	sender := inframailmemory.NewSender()
	require.NoError(t, sender.Send(context.Background(), domainmail.Message{To: "a@x.com", Subject: "1", Body: "b"}))
	require.NoError(t, sender.Send(context.Background(), domainmail.Message{To: "b@x.com", Subject: "2", Body: "b"}))
	require.Len(t, sender.Messages, 2)
}
