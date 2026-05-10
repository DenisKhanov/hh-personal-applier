package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"hh-personal-applier/internal/api"
)

const testSecret = "12345678901234567890123456789012"

func okHandler(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
}

func TestSecretMiddlewareMissingHeaderReturns401(t *testing.T) {
	handler := api.SecretMiddleware(testSecret)(http.HandlerFunc(okHandler))
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	assertUnauthorized(t, w)
}

func TestSecretMiddlewareWrongHeaderReturns401(t *testing.T) {
	handler := api.SecretMiddleware(testSecret)(http.HandlerFunc(okHandler))
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("X-Local-Secret", "wrong-secret")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	assertUnauthorized(t, w)
}

func TestSecretMiddlewareCorrectHeaderPasses(t *testing.T) {
	handler := api.SecretMiddleware(testSecret)(http.HandlerFunc(okHandler))
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("X-Local-Secret", testSecret)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func assertUnauthorized(t *testing.T, w *httptest.ResponseRecorder) {
	t.Helper()

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}

	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Error.Code != "unauthorized" {
		t.Errorf("expected error code unauthorized, got %q", body.Error.Code)
	}
}
