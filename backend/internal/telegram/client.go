package telegram

import (
	"context"
	"net/http"
	"strings"
	"time"

	"hh-personal-applier/internal/storage"

	telebot "gopkg.in/telebot.v3"
)

type TelebotClient struct {
	bot         *telebot.Bot
	chat        *telebot.Chat
	token       string
	ownerChatID int64
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
		bot:         bot,
		chat:        &telebot.Chat{ID: ownerChatID},
		token:       token,
		ownerChatID: ownerChatID,
	}, nil
}

func (c *TelebotClient) Send(ctx context.Context, message Message) error {
	done := make(chan error, 1)
	go func() {
		options := []interface{}{}
		if markup := replyMarkup(message.Buttons); markup != nil {
			options = append(options, markup)
		}
		_, err := c.bot.Send(c.chat, message.Text, options...)
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

func (c *TelebotClient) RegisterCoverLetterCallbacks(resolver CoverLetterCallbackResolver) {
	handler := NewCoverLetterCallbackHandler(c.ownerChatID, resolver)
	button := &telebot.InlineButton{Unique: CoverLetterCallbackUnique}
	c.bot.Handle(button, func(ctx telebot.Context) error {
		callback := ctx.Callback()
		if callback == nil || callback.Sender == nil {
			return nil
		}
		handled, err := handler.Handle(context.Background(), CallbackEvent{
			SenderChatID: callback.Sender.ID,
			Data:         callback.Data,
		})
		if err != nil {
			return err
		}
		if !handled {
			return nil
		}
		return ctx.Respond(&telebot.CallbackResponse{Text: callbackResponseText(callback.Data)})
	})
}

func (c *TelebotClient) Run(ctx context.Context) {
	done := make(chan struct{})
	go func() {
		c.bot.Start()
		close(done)
	}()

	select {
	case <-ctx.Done():
		c.bot.Stop()
		<-done
	case <-done:
	}
}

func replyMarkup(buttons [][]Button) *telebot.ReplyMarkup {
	if len(buttons) == 0 {
		return nil
	}
	markup := &telebot.ReplyMarkup{}
	rows := make([][]telebot.InlineButton, 0, len(buttons))
	for _, row := range buttons {
		if len(row) == 0 {
			continue
		}
		telegramRow := make([]telebot.InlineButton, 0, len(row))
		for _, button := range row {
			telegramRow = append(telegramRow, telebot.InlineButton{
				Text:   button.Text,
				Unique: button.Unique,
				Data:   button.Data,
			})
		}
		rows = append(rows, telegramRow)
	}
	if len(rows) == 0 {
		return nil
	}
	markup.InlineKeyboard = rows
	return markup
}

func callbackResponseText(data string) string {
	callback, err := ParseCoverLetterCallbackData(data)
	if err != nil {
		return "Callback ignored"
	}
	switch callback.Action {
	case storage.CoverLetterCallbackApprove:
		return "Письмо одобрено"
	case storage.CoverLetterCallbackEdit:
		return "Автоотправка письма пропущена"
	case storage.CoverLetterCallbackSkip:
		return "Письмо пропущено"
	default:
		return "Callback handled"
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
