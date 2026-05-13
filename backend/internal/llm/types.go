package llm

import (
	"context"
	"errors"
	"fmt"
)

type Language string

const (
	LanguageRU Language = "ru"
	LanguageEN Language = "en"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type Provider interface {
	Generate(ctx context.Context, messages []Message) (string, error)
}

type RateLimitError struct {
	message string
}

func NewRateLimitError(message string) error {
	if message == "" {
		message = "LLM provider rate limited the request"
	}
	return &RateLimitError{message: message}
}

func (e *RateLimitError) Error() string {
	return e.message
}

func IsRateLimit(err error) bool {
	var rateLimitErr *RateLimitError
	return errors.As(err, &rateLimitErr)
}

func providerError(statusCode int, body string) error {
	if statusCode == 429 {
		return NewRateLimitError("LLM provider rate limit")
	}
	if len(body) > 500 {
		body = body[:500]
	}
	return fmt.Errorf("LLM provider returned HTTP %d: %s", statusCode, body)
}
