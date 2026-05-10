package api

import (
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"

	"hh-personal-applier/internal/storage"
)

func NewRouter(secret string, store storage.Store) http.Handler {
	installHumaErrorShape()

	mux := http.NewServeMux()

	cfg := huma.DefaultConfig("HH Personal Applier", "0.1.0")
	cfg.DocsPath = ""
	cfg.SchemasPath = ""
	cfg.CreateHooks = nil
	api := humago.New(mux, cfg)

	registerHealth(api)
	if store != nil {
		registerStage3(api, store)
	}

	return SecretMiddleware(secret)(mux)
}
