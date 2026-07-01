package memory

import (
	"context"
	"sync"

	domainmail "admin/internal/domain/mail"
)

// Sender records sent messages for tests.
type Sender struct {
	mu       sync.Mutex
	Messages []domainmail.Message
}

func NewSender() *Sender {
	return &Sender{}
}

func (s *Sender) Send(_ context.Context, msg domainmail.Message) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Messages = append(s.Messages, msg)
	return nil
}

var _ domainmail.Sender = (*Sender)(nil)
