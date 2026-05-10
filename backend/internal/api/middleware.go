package api

import (
	"crypto/subtle"
	"net/http"
)

func SecretMiddleware(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Local-Secret")), []byte(secret)) != 1 {
				writeError(w, http.StatusUnauthorized, "unauthorized", "invalid or missing X-Local-Secret")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
