package telegram

import (
	"context"
	"net/http"
	"strings"
	"time"

	telebot "gopkg.in/telebot.v3"
)

type TelebotClient struct {
	bot   *telebot.Bot
	chat  *telebot.Chat
	token string
}

func NewTelebotClient(token string, ownerChatID int64) (*TelebotClient, error) {
	return newTelebotClient(token, ownerChatID, "", &http.Client{Timeout: 10 * time.Second})
}

func newTelebotClient(token string, ownerChatID int64, apiURL string, httpClient *http.Client) (*TelebotClient, error) {
	bot, err := telebot.NewBot(telebot.Settings{
		Token:   token,
		URL:     apiURL,
		Offline: true,
		Client:  httpClient,
	})
	if err != nil {
		return nil, err
	}
	return &TelebotClient{
		bot:   bot,
		chat:  &telebot.Chat{ID: ownerChatID},
		token: token,
	}, nil
}

func (c *TelebotClient) Send(ctx context.Context, message Message) error {
	done := make(chan error, 1)
	go func() {
		_, err := c.bot.Send(c.chat, message.Text)
		done <- err
	}()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-done:
		if err != nil {
			return redactToken(err, c.token)
		}
		return nil
	}
}

type redactedError struct {
	text string
}

func (e redactedError) Error() string {
	return e.text
}

func redactToken(err error, token string) error {
	if err == nil {
		return nil
	}
	text := err.Error()
	if token != "" {
		text = strings.ReplaceAll(text, token, "<redacted>")
	}
	return redactedError{text: text}
}
