package telegram

import (
	"context"
	"testing"

	"hh-personal-applier/internal/storage"
)

func TestParseCoverLetterCallbackData(t *testing.T) {
	callback, err := ParseCoverLetterCallbackData("approve|42")
	if err != nil {
		t.Fatalf("parse callback: %v", err)
	}
	if callback.Action != storage.CoverLetterCallbackApprove || callback.VacancyID != "42" {
		t.Fatalf("unexpected callback: %+v", callback)
	}
}

func TestCoverLetterCallbackHandlerIgnoresNonOwner(t *testing.T) {
	resolver := &fakeCallbackResolver{}
	handler := NewCoverLetterCallbackHandler(398276480, resolver)

	handled, err := handler.Handle(context.Background(), CallbackEvent{
		SenderChatID: 1,
		Data:         "approve|42",
	})
	if err != nil {
		t.Fatalf("handle non-owner: %v", err)
	}
	if handled {
		t.Fatal("expected non-owner callback to be ignored")
	}
	if resolver.calls != 0 {
		t.Fatalf("expected resolver not to be called, got %d", resolver.calls)
	}
}

func TestCoverLetterCallbackHandlerResolvesOwnerCallback(t *testing.T) {
	resolver := &fakeCallbackResolver{
		result: storage.CoverLetterCallbackResult{
			Changed: true,
			Letter: storage.CoverLetter{
				VacancyID: "42",
				Status:    storage.CoverLetterStatusApproved,
			},
		},
	}
	handler := NewCoverLetterCallbackHandler(398276480, resolver)

	handled, err := handler.Handle(context.Background(), CallbackEvent{
		SenderChatID: 398276480,
		Data:         "approve|42",
	})
	if err != nil {
		t.Fatalf("handle owner callback: %v", err)
	}
	if !handled {
		t.Fatal("expected owner callback to be handled")
	}
	if resolver.calls != 1 {
		t.Fatalf("expected one resolver call, got %d", resolver.calls)
	}
	if resolver.callback.Action != storage.CoverLetterCallbackApprove || resolver.callback.VacancyID != "42" {
		t.Fatalf("unexpected callback passed to resolver: %+v", resolver.callback)
	}
}

type fakeCallbackResolver struct {
	calls    int
	callback storage.CoverLetterCallback
	result   storage.CoverLetterCallbackResult
}

func (f *fakeCallbackResolver) ResolveCallback(_ context.Context, callback storage.CoverLetterCallback) (storage.CoverLetterCallbackResult, error) {
	f.calls++
	f.callback = callback
	return f.result, nil
}
