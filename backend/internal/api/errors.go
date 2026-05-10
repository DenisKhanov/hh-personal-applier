package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"hh-personal-applier/internal/storage"
)

type errorBody struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details"`
}

type errorEnvelope struct {
	Error errorBody `json:"error"`
}

type statusError struct {
	status int
	body   errorEnvelope
}

func newStatusError(status int, code string, message string) *statusError {
	return &statusError{
		status: status,
		body: errorEnvelope{
			Error: errorBody{
				Code:    code,
				Message: message,
				Details: map[string]any{},
			},
		},
	}
}

func (e *statusError) Error() string {
	return e.body.Error.Message
}

func (e *statusError) GetStatus() int {
	return e.status
}

func (e *statusError) MarshalJSON() ([]byte, error) {
	return json.Marshal(e.body)
}

func installHumaErrorShape() {
	huma.NewError = func(status int, msg string, errs ...error) huma.StatusError {
		code := "internal_error"
		switch status {
		case http.StatusBadRequest, http.StatusUnprocessableEntity:
			code = "invalid_request"
		case http.StatusUnauthorized:
			code = "unauthorized"
		case http.StatusNotFound:
			code = "not_found"
		case http.StatusConflict:
			code = "conflict"
		}
		if msg == "" {
			msg = http.StatusText(status)
		}
		return newStatusError(status, code, msg)
	}
	huma.NewErrorWithContext = func(_ huma.Context, status int, msg string, errs ...error) huma.StatusError {
		return huma.NewError(status, msg, errs...)
	}
}

func apiError(err error) error {
	if err == nil {
		return nil
	}

	var opErr *storage.OpError
	if errors.As(err, &opErr) {
		switch opErr.Kind {
		case storage.ErrorKindValidation:
			return newStatusError(http.StatusBadRequest, opErr.Code, opErr.Message)
		case storage.ErrorKindNotFound:
			return newStatusError(http.StatusNotFound, opErr.Code, opErr.Message)
		case storage.ErrorKindConflict:
			return newStatusError(http.StatusConflict, opErr.Code, opErr.Message)
		}
	}

	slog.Error("api internal error", "err", err)
	return newStatusError(http.StatusInternalServerError, "internal_error", "internal server error")
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(newStatusError(status, code, message).body)
}
