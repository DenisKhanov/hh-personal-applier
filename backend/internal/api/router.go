package api

import (
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
)

func NewRouter(secret string) http.Handler {
	mux := http.NewServeMux()

	cfg := huma.DefaultConfig("HH Personal Applier", "0.1.0")
	cfg.DocsPath = ""
	cfg.SchemasPath = ""
	cfg.CreateHooks = nil
	api := humago.New(mux, cfg)

	registerHealth(api)

	return SecretMiddleware(secret)(mux)
}
