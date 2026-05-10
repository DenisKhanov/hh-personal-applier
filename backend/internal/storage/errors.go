package storage

type ErrorKind string

const (
	ErrorKindValidation ErrorKind = "validation"
	ErrorKindNotFound   ErrorKind = "not_found"
	ErrorKindConflict   ErrorKind = "conflict"
)

type OpError struct {
	Kind    ErrorKind
	Code    string
	Message string
}

func (e *OpError) Error() string {
	return e.Message
}

func NewValidation(code string, message string) error {
	return &OpError{Kind: ErrorKindValidation, Code: code, Message: message}
}

func NewNotFound(code string, message string) error {
	return &OpError{Kind: ErrorKindNotFound, Code: code, Message: message}
}

func NewConflict(code string, message string) error {
	return &OpError{Kind: ErrorKindConflict, Code: code, Message: message}
}
