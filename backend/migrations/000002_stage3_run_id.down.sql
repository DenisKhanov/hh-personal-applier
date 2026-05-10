DROP INDEX IF EXISTS apply_runs_one_active_idx;
DROP INDEX IF EXISTS processed_vacancies_run_id_idx;

ALTER TABLE processed_vacancies
    DROP COLUMN IF EXISTS run_id;
