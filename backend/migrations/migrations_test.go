package migrations

import (
	"os"
	"strings"
	"testing"
)

func TestAutoApplyDefaultsToManualConfirmation(t *testing.T) {
	initial, err := os.ReadFile("000001_initial.up.sql")
	if err != nil {
		t.Fatalf("read initial migration: %v", err)
	}
	if !strings.Contains(string(initial), "auto_apply BOOLEAN NOT NULL DEFAULT FALSE") {
		t.Fatalf("expected initial migration to default auto_apply to FALSE")
	}

	autoApplyDefault, err := os.ReadFile("000004_auto_apply_default.up.sql")
	if err != nil {
		t.Fatalf("read auto apply migration: %v", err)
	}
	if strings.Contains(strings.ToUpper(string(autoApplyDefault)), "SET AUTO_APPLY = TRUE") ||
		strings.Contains(strings.ToUpper(string(autoApplyDefault)), "DEFAULT TRUE") {
		t.Fatalf("auto apply migration must not enable auto_apply or set TRUE default")
	}

	manualDefault, err := os.ReadFile("000005_manual_auto_apply_default.up.sql")
	if err != nil {
		t.Fatalf("read manual auto apply migration: %v", err)
	}
	if !strings.Contains(string(manualDefault), "ALTER COLUMN auto_apply SET DEFAULT FALSE") {
		t.Fatalf("manual auto apply migration must set auto_apply default to FALSE")
	}
}
