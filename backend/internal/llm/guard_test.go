package llm

import "testing"

func TestDetectLanguageUsesCyrillicShare(t *testing.T) {
	if got := DetectLanguage("Разработка Go сервисов и PostgreSQL"); got != LanguageRU {
		t.Fatalf("expected ru, got %q", got)
	}
	if got := DetectLanguage("Go backend services with PostgreSQL and Kafka"); got != LanguageEN {
		t.Fatalf("expected en, got %q", got)
	}
}

func TestValidateCoverLetterRejectsForbiddenPhrases(t *testing.T) {
	err := ValidateCoverLetter("Здравствуйте. Я начинающий разработчик и быстро обучаюсь. Рассмотрите мою кандидатуру.", LanguageRU)
	if err == nil {
		t.Fatal("expected forbidden phrase rejection")
	}
}

func TestValidateCoverLetterRejectsOverlongText(t *testing.T) {
	text := make([]rune, maxCoverLetterRunes+1)
	for i := range text {
		text[i] = 'а'
	}

	err := ValidateCoverLetter(string(text), LanguageRU)
	if err == nil {
		t.Fatal("expected overlong cover letter rejection")
	}
}

func TestValidateCoverLetterAcceptsSpecificConciseLetter(t *testing.T) {
	text := "Здравствуйте! Мне интересна вакансия Go Backend Developer: в последних проектах я проектировал REST API, работал с PostgreSQL, Docker и очередями. Могу быть полезен в задачах, где важны надежный backend, понятные интерфейсы и аккуратная работа с данными."

	if err := ValidateCoverLetter(text, LanguageRU); err != nil {
		t.Fatalf("expected valid cover letter, got %v", err)
	}
}
