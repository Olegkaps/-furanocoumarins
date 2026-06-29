package mail

import "context"

// Message is a value object representing an outbound email.
type Message struct {
	To      string
	Subject string
	Body    string
}

// Sender is the outbound port for email delivery (hexagonal architecture).
type Sender interface {
	Send(ctx context.Context, msg Message) error
}
