package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const defaultGroqBaseURL = "https://api.groq.com/openai/v1"

type GroqConfig struct {
	APIKey     string
	Model      string
	BaseURL    string
	HTTPClient *http.Client
}

type GroqProvider struct {
	apiKey  string
	model   string
	baseURL string
	client  *http.Client
}

type groqChatRequest struct {
	Model               string    `json:"model"`
	Messages            []Message `json:"messages"`
	Temperature         float64   `json:"temperature"`
	MaxCompletionTokens int       `json:"max_completion_tokens"`
	Stream              bool      `json:"stream"`
}

type groqChatResponse struct {
	Choices []groqChoice `json:"choices"`
}

type groqChoice struct {
	Message groqMessage `json:"message"`
}

type groqMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func NewGroqProvider(cfg GroqConfig) *GroqProvider {
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = defaultGroqBaseURL
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return &GroqProvider{
		apiKey:  strings.TrimSpace(cfg.APIKey),
		model:   strings.TrimSpace(cfg.Model),
		baseURL: baseURL,
		client:  client,
	}
}

func (p *GroqProvider) Generate(ctx context.Context, messages []Message) (string, error) {
	if p.apiKey == "" {
		return "", fmt.Errorf("LLM API key is required")
	}
	if p.model == "" {
		return "", fmt.Errorf("LLM model is required")
	}

	payload := groqChatRequest{
		Model:               p.model,
		Messages:            messages,
		Temperature:         0.4,
		MaxCompletionTokens: 512,
		Stream:              false,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/chat/completions", bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.apiKey)

	resp, err := p.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", providerError(resp.StatusCode, string(body))
	}

	var decoded groqChatResponse
	if err := json.Unmarshal(body, &decoded); err != nil {
		return "", fmt.Errorf("decode LLM response: %w", err)
	}
	if len(decoded.Choices) == 0 {
		return "", fmt.Errorf("LLM response contained no choices")
	}
	return CleanCoverLetter(decoded.Choices[0].Message.Content), nil
}
