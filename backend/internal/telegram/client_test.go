package telegram

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTelebotClientSendKeepsTelegramErrorDetailsAndRedactsToken(t *testing.T) {
	token := "123456:secret-token"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/bot"+token+"/sendMessage" {
			t.Fatalf("expected sendMessage path, got %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":          false,
			"error_code":  400,
			"description": "Bad Request: chat not found",
		})
	}))
	defer server.Close()

	client, err := newTelebotClient(token, 398276480, server.URL, server.Client())
	if err != nil {
		t.Fatalf("new client: %v", err)
	}

	err = client.Send(context.Background(), Message{Text: "test"})
	if err == nil {
		t.Fatal("expected telegram API error, got nil")
	}
	if !strings.Contains(err.Error(), "chat not found") {
		t.Fatalf("expected detailed telegram error, got %q", err.Error())
	}
	if strings.Contains(err.Error(), token) {
		t.Fatalf("telegram token leaked in error: %q", err.Error())
	}
}
