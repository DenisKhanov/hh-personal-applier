package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGroqProviderPostsChatCompletionRequest(t *testing.T) {
	var authHeader string
	var requestedPath string
	var requestBody groqChatRequest

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader = r.Header.Get("Authorization")
		requestedPath = r.URL.Path
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(groqChatResponse{
			Choices: []groqChoice{{
				Message: groqMessage{Role: "assistant", Content: "Generated letter"},
			}},
		})
	}))
	defer server.Close()

	provider := NewGroqProvider(GroqConfig{
		APIKey:     "secret-key",
		Model:      "llama-3.3-70b-versatile",
		BaseURL:    server.URL + "/openai/v1",
		HTTPClient: server.Client(),
	})

	text, err := provider.Generate(context.Background(), []Message{{
		Role:    "user",
		Content: "write",
	}})
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	if text != "Generated letter" {
		t.Fatalf("unexpected generated text: %q", text)
	}
	if requestedPath != "/openai/v1/chat/completions" {
		t.Fatalf("unexpected path %q", requestedPath)
	}
	if authHeader != "Bearer secret-key" {
		t.Fatalf("unexpected auth header %q", authHeader)
	}
	if requestBody.Model != "llama-3.3-70b-versatile" {
		t.Fatalf("unexpected model %q", requestBody.Model)
	}
	if len(requestBody.Messages) != 1 || requestBody.Messages[0].Content != "write" {
		t.Fatalf("unexpected messages: %+v", requestBody.Messages)
	}
}

func TestGroqProviderMarksHTTP429AsRateLimit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"error":{"message":"rate limit"}}`, http.StatusTooManyRequests)
	}))
	defer server.Close()

	provider := NewGroqProvider(GroqConfig{
		APIKey:     "secret-key",
		Model:      "llama-3.3-70b-versatile",
		BaseURL:    server.URL,
		HTTPClient: server.Client(),
	})

	_, err := provider.Generate(context.Background(), []Message{{Role: "user", Content: "write"}})
	if err == nil {
		t.Fatal("expected rate limit error")
	}
	if !IsRateLimit(err) {
		t.Fatalf("expected rate limit error, got %T %v", err, err)
	}
	if strings.Contains(err.Error(), "secret-key") {
		t.Fatalf("provider error leaked API key: %v", err)
	}
}
