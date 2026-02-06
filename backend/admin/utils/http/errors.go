package http

type UserError struct {
	E error
}

func (e *UserError) Error() string {
	return "Bad request: " + e.E.Error()
}

type ServerError struct {
	E error
}

func (e *ServerError) Error() string {
	return "Internal error: " + e.E.Error()
}
