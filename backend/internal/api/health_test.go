package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"hh-personal-applier/internal/api"
)

func TestHealthWithSecretReturns200(t *testing.T) {
	mux := api.NewRouter(testSecret)
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("X-Local-Secret", testSecret)
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "$schema") {
		t.Fatalf("expected compact health response without $schema, got %s", w.Body.String())
	}

	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Status != "ok" {
		t.Errorf("expected status ok, got %q", body.Status)
	}
}

func TestHealthWithoutSecretReturns401(t *testing.T) {
	mux := api.NewRouter(testSecret)
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}
