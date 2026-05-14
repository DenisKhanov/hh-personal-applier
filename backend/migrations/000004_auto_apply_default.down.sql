ALTER TABLE owner_settings
    ALTER COLUMN auto_apply SET DEFAULT FALSE;

UPDATE owner_settings
SET auto_apply = FALSE,
    updated_at = now()
WHERE id = TRUE
  AND auto_apply = TRUE;
