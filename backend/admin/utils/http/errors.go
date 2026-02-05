package http

type UserError struct {
	E error
}

func (ue *UserError) Error() string {
	return "Bad request: " + ue.E.Error()
}

type ServerError struct {
	E error
}

func (se *ServerError) Error() string {
	return "Internal error: " + se.E.Error()
}
