package api_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"hh-personal-applier/internal/api"
	"hh-personal-applier/internal/storage"
)

func TestCoverLetterRequestHandlerValidatesVacancyID(t *testing.T) {
	store := newFakeStore()
	coverLetters := &fakeCoverLetterService{}
	mux := apiRouterWithCoverLetters(store, coverLetters)

	response := doJSON(t, mux, http.MethodPost, "/cover_letters/request", map[string]any{
		"vacancyTitle":       "Go Backend Developer",
		"vacancyDescription": "Нужен Go разработчик.",
	})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected missing vacancyId 400, got %d: %s", response.Code, response.Body.String())
	}
	assertErrorCode(t, response, "invalid_vacancy_id")
}

func TestCoverLetterRequestAndGetHandlers(t *testing.T) {
	store := newFakeStore()
	coverLetters := &fakeCoverLetterService{
		letter: storage.CoverLetter{
			ID:           "letter-42",
			VacancyID:    "42",
			VacancyTitle: "Go Backend Developer",
			Body:         "Здравствуйте! Могу быть полезен в backend задачах.",
			Language:     storage.CoverLetterLanguageRU,
			Status:       storage.CoverLetterStatusPendingApproval,
			ExpiresAt:    time.Date(2026, 5, 12, 13, 0, 0, 0, time.UTC),
		},
	}
	mux := apiRouterWithCoverLetters(store, coverLetters)

	requestResponse := doJSON(t, mux, http.MethodPost, "/cover_letters/request", map[string]any{
		"runId":              "run-1",
		"vacancyId":          "42",
		"vacancyTitle":       "Go Backend Developer",
		"vacancyDescription": "Нужен Go разработчик.",
		"vacancyUrl":         "https://hh.ru/vacancy/42",
	})
	if requestResponse.Code != http.StatusOK {
		t.Fatalf("expected request 200, got %d: %s", requestResponse.Code, requestResponse.Body.String())
	}
	if coverLetters.request.VacancyID != "42" || coverLetters.request.RunID != "run-1" {
		t.Fatalf("unexpected request captured by service: %+v", coverLetters.request)
	}

	var requested storage.CoverLetter
	decodeJSON(t, requestResponse, &requested)
	if requested.Status != storage.CoverLetterStatusPendingApproval {
		t.Fatalf("unexpected requested letter: %+v", requested)
	}
	if requested.Body != "" {
		t.Fatalf("pending cover letter body must not be exposed to extension, got %q", requested.Body)
	}

	getResponse := doJSON(t, mux, http.MethodGet, "/cover_letters/42", nil)
	if getResponse.Code != http.StatusOK {
		t.Fatalf("expected get 200, got %d: %s", getResponse.Code, getResponse.Body.String())
	}
	var got storage.CoverLetter
	decodeJSON(t, getResponse, &got)
	if got.VacancyID != "42" || got.Status != storage.CoverLetterStatusPendingApproval {
		t.Fatalf("unexpected get response: %+v", got)
	}
}

func TestCoverLetterGetHandlerExposesBodyOnlyAfterApproval(t *testing.T) {
	store := newFakeStore()
	coverLetters := &fakeCoverLetterService{
		letter: storage.CoverLetter{
			ID:           "letter-42",
			VacancyID:    "42",
			VacancyTitle: "Go Backend Developer",
			Body:         "Здравствуйте! Могу быть полезен в backend задачах.",
			Language:     storage.CoverLetterLanguageRU,
			Status:       storage.CoverLetterStatusApproved,
			ExpiresAt:    time.Date(2026, 5, 12, 13, 0, 0, 0, time.UTC),
		},
	}
	mux := apiRouterWithCoverLetters(store, coverLetters)

	response := doJSON(t, mux, http.MethodGet, "/cover_letters/42", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("expected get approved letter 200, got %d: %s", response.Code, response.Body.String())
	}

	var got storage.CoverLetter
	decodeJSON(t, response, &got)
	if got.Status != storage.CoverLetterStatusApproved || got.Body == "" {
		t.Fatalf("expected approved cover letter body to be visible, got %+v", got)
	}
}

type fakeCoverLetterService struct {
	request storage.CoverLetterRequest
	letter  storage.CoverLetter
}

func apiRouterWithCoverLetters(store storage.Store, coverLetters api.CoverLetterService) http.Handler {
	return api.NewRouterWithCoverLetters(testSecret, store, coverLetters)
}

func (f *fakeCoverLetterService) Request(_ context.Context, request storage.CoverLetterRequest) (storage.CoverLetter, error) {
	f.request = request
	return f.letter, nil
}

func (f *fakeCoverLetterService) Get(_ context.Context, vacancyID string) (storage.CoverLetter, error) {
	if f.letter.VacancyID != vacancyID {
		return storage.CoverLetter{}, storage.NewNotFound("cover_letter_not_found", "cover letter not found")
	}
	return f.letter, nil
}
