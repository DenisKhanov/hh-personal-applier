package telegram

import (
	"context"
	"fmt"
	"strings"

	"hh-personal-applier/internal/storage"
)

type CallbackEvent struct {
	SenderChatID int64
	Data         string
}

type CoverLetterCallbackResolver interface {
	ResolveCallback(ctx context.Context, callback storage.CoverLetterCallback) (storage.CoverLetterCallbackResult, error)
}

type CoverLetterCallbackHandler struct {
	ownerChatID int64
	resolver    CoverLetterCallbackResolver
}

func NewCoverLetterCallbackHandler(ownerChatID int64, resolver CoverLetterCallbackResolver) *CoverLetterCallbackHandler {
	return &CoverLetterCallbackHandler{
		ownerChatID: ownerChatID,
		resolver:    resolver,
	}
}

func (h *CoverLetterCallbackHandler) Handle(ctx context.Context, event CallbackEvent) (bool, error) {
	if event.SenderChatID != h.ownerChatID {
		return false, nil
	}
	callback, err := ParseCoverLetterCallbackData(event.Data)
	if err != nil {
		return false, err
	}
	_, err = h.resolver.ResolveCallback(ctx, callback)
	if err != nil {
		return false, err
	}
	return true, nil
}

func ParseCoverLetterCallbackData(data string) (storage.CoverLetterCallback, error) {
	parts := strings.Split(strings.TrimSpace(data), "|")
	if len(parts) != 2 || strings.TrimSpace(parts[1]) == "" {
		return storage.CoverLetterCallback{}, fmt.Errorf("invalid cover letter callback data")
	}

	action := storage.CoverLetterCallbackAction(parts[0])
	switch action {
	case storage.CoverLetterCallbackApprove,
		storage.CoverLetterCallbackEdit,
		storage.CoverLetterCallbackSkip:
	default:
		return storage.CoverLetterCallback{}, fmt.Errorf("invalid cover letter callback action")
	}

	return storage.CoverLetterCallback{
		Action:    action,
		VacancyID: strings.TrimSpace(parts[1]),
	}, nil
}
