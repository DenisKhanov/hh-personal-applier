package llm

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const maxCoverLetterRunes = 1500

var forbiddenCoverLetterPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)у\s+меня\s+нет\s+коммерческого\s+опыта|коммерческого\s+опыта\s+у\s+меня\s+нет|опыт\s+отсутствует`),
	regexp.MustCompile(`(?i)я\s+начинающ(?:ий|ая)\s+разработчик|я\s+только\s+учусь|я\s+быстро\s+обучаюсь`),
	regexp.MustCompile(`(?i)готов(?:а)?\s+работать\s+за\s+любую\s+зарплату|мне\s+очень\s+нужна\s+работа`),
	regexp.MustCompile(`(?i)рассмотрите\s+мою\s+кандидатуру|несмотря\s+на\s+отсутствие\s+опыта`),
	regexp.MustCompile(`(?i)я\s+не\s+полностью\s+соответствую\s+требованиям|я\s+пока\s+не\s+знаю,\s+но\s+могу\s+разобраться`),
	regexp.MustCompile(`(?i)буду\s+рад(?:а)?\s+любой\s+возможности|я\s+использовал\s+chatgpt`),
	regexp.MustCompile(`(?i)я\s+идеально\s+подхожу|я\s+лучший\s+кандидат`),
	regexp.MustCompile(`(?i)very\s+interested\s+in\s+your\s+vacancy`),
	regexp.MustCompile(`(?i)i\s+don'?t\s+have\s+commercial\s+experience|i\s+am\s+a\s+beginner|i\s+am\s+just\s+learning`),
	regexp.MustCompile(`(?i)i\s+am\s+ready\s+to\s+work\s+for\s+any\s+salary`),
	regexp.MustCompile(`(?i)as\s+an\s+ai|как\s+искусственный\s+интеллект`),
}

func DetectLanguage(text string) Language {
	var cyrillic int
	var latin int
	for _, r := range text {
		switch {
		case unicode.In(r, unicode.Cyrillic):
			cyrillic++
		case unicode.Is(unicode.Latin, r):
			latin++
		}
	}
	if cyrillic > 0 && cyrillic*3 >= latin {
		return LanguageRU
	}
	return LanguageEN
}

func ValidateCoverLetter(text string, _ Language) error {
	normalized := strings.Join(strings.Fields(text), " ")
	if normalized == "" {
		return fmt.Errorf("cover letter is empty")
	}
	if utf8.RuneCountInString(normalized) > maxCoverLetterRunes {
		return fmt.Errorf("cover letter is longer than %d characters", maxCoverLetterRunes)
	}
	for _, pattern := range forbiddenCoverLetterPatterns {
		if pattern.MatchString(normalized) {
			return fmt.Errorf("cover letter contains forbidden phrase")
		}
	}
	return nil
}

func CleanCoverLetter(text string) string {
	cleaned := strings.TrimSpace(text)
	cleaned = strings.TrimPrefix(cleaned, "```text")
	cleaned = strings.TrimPrefix(cleaned, "```")
	cleaned = strings.TrimSuffix(cleaned, "```")
	cleaned = strings.TrimSpace(cleaned)
	cleaned = strings.Trim(cleaned, "\"")
	return strings.TrimSpace(cleaned)
}
