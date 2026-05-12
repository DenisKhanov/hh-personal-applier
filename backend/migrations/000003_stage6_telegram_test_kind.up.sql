ALTER TABLE notifications_outbox
    DROP CONSTRAINT notifications_outbox_kind_check;

ALTER TABLE notifications_outbox
    ADD CONSTRAINT notifications_outbox_kind_check
    CHECK (kind IN (
        'captcha', 'error', 'daily_limit_reached',
        'cover_letter_approval', 'daily_report', 'login_lost',
        'telegram_test'
    ));
