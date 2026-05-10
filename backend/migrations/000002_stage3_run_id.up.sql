ALTER TABLE processed_vacancies
    ADD COLUMN run_id UUID REFERENCES apply_runs(id);

CREATE INDEX processed_vacancies_run_id_idx ON processed_vacancies(run_id);

CREATE UNIQUE INDEX apply_runs_one_active_idx
    ON apply_runs ((TRUE))
    WHERE status IN ('running', 'paused_captcha', 'paused_unknown', 'paused_network');
