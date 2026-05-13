package llm

import (
	"fmt"
	"strings"
)

type CoverLetterPromptInput struct {
	Language           Language
	CandidateBio       string
	VacancyTitle       string
	VacancyDescription string
}

const defaultCandidateBio = "Go backend developer. Relevant experience: REST and gRPC APIs, PostgreSQL, Redis, Docker, Kafka services, Clean Architecture. Projects that may be mentioned when relevant: PrivateKeeper, ShortenerURL, TgBot, ResumeGame."

func BuildCoverLetterMessages(input CoverLetterPromptInput) []Message {
	bio := strings.TrimSpace(input.CandidateBio)
	if bio == "" {
		bio = defaultCandidateBio
	}

	description := strings.TrimSpace(input.VacancyDescription)
	if len([]rune(description)) > 500 {
		description = string([]rune(description)[:500])
	}

	prompt := fmt.Sprintf(`Ты пишешь короткое сопроводительное письмо для отклика на вакансию.

Требования:
- 3-5 предложений
- деловой, уверенный, продающий стиль
- без чрезмерной эмоциональности
- без фраз о нехватке опыта
- без шаблонных фраз без конкретики
- язык письма: %s
- можно упомянуть 1-2 релевантных проекта если уместно

Профиль кандидата:
%s

Название вакансии:
%s

Описание вакансии:
%s

Сгенерируй только текст письма без заголовков и пояснений.`, input.Language, bio, strings.TrimSpace(input.VacancyTitle), description)

	return []Message{
		{Role: "system", Content: "You generate concise cover letters for job applications and return only the final letter text."},
		{Role: "user", Content: prompt},
	}
}
