package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"hh-personal-applier/internal/storage"
)

type CoverLetterService interface {
	Request(ctx context.Context, request storage.CoverLetterRequest) (storage.CoverLetter, error)
	Get(ctx context.Context, vacancyID string) (storage.CoverLetter, error)
}

type coverLetterRequestInput struct {
	Body storage.CoverLetterRequest
}

type coverLetterOutput struct {
	Body storage.CoverLetter
}

type coverLetterGetInput struct {
	VacancyID string `path:"vacancy_id"`
}

func registerStage7(api huma.API, service CoverLetterService) {
	huma.Register(api, huma.Operation{
		OperationID: "request-cover-letter",
		Method:      http.MethodPost,
		Path:        "/cover_letters/request",
		Summary:     "Generate or return a cover letter for a vacancy",
		Tags:        []string{"cover_letters"},
	}, func(ctx context.Context, input *coverLetterRequestInput) (*coverLetterOutput, error) {
		if strings.TrimSpace(input.Body.VacancyID) == "" {
			return nil, newStatusError(http.StatusBadRequest, "invalid_vacancy_id", "vacancyId is required")
		}
		if strings.TrimSpace(input.Body.VacancyTitle) == "" {
			return nil, newStatusError(http.StatusBadRequest, "invalid_vacancy_title", "vacancyTitle is required")
		}
		if strings.TrimSpace(input.Body.VacancyDescription) == "" {
			return nil, newStatusError(http.StatusBadRequest, "invalid_vacancy_description", "vacancyDescription is required")
		}
		letter, err := service.Request(ctx, input.Body)
		if err != nil {
			return nil, apiError(err)
		}
		return &coverLetterOutput{Body: coverLetterAPIResponse(letter)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-cover-letter",
		Method:      http.MethodGet,
		Path:        "/cover_letters/{vacancy_id}",
		Summary:     "Get cover letter status by vacancy id",
		Tags:        []string{"cover_letters"},
	}, func(ctx context.Context, input *coverLetterGetInput) (*coverLetterOutput, error) {
		vacancyID := strings.TrimSpace(input.VacancyID)
		if vacancyID == "" {
			return nil, newStatusError(http.StatusBadRequest, "invalid_vacancy_id", "vacancyId is required")
		}
		letter, err := service.Get(ctx, vacancyID)
		if err != nil {
			return nil, apiError(err)
		}
		return &coverLetterOutput{Body: coverLetterAPIResponse(letter)}, nil
	})
}

func coverLetterAPIResponse(letter storage.CoverLetter) storage.CoverLetter {
	if letter.Status != storage.CoverLetterStatusApproved {
		letter.Body = ""
	}
	return letter
}
