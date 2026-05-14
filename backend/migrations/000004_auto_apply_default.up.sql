ALTER TABLE owner_settings
    ALTER COLUMN auto_apply SET DEFAULT TRUE;

UPDATE owner_settings
SET auto_apply = TRUE,
    updated_at = now()
WHERE id = TRUE
  AND auto_apply = FALSE;
