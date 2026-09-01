package cassandra

import (
	"strings"
	"testing"
)

func TestReserveTableCQLIsConditionalAndParameterized(t *testing.T) {
	if !strings.Contains(reserveTableCQL, "IF NOT EXISTS") {
		t.Fatal("registry reservation must be a lightweight transaction")
	}
	if strings.Count(reserveTableCQL, "?") != 8 {
		t.Fatalf("registry reservation must bind all values: %q", reserveTableCQL)
	}
}

func TestTableActivationQueriesRequireReadyTargetAndHeldSingletonLock(t *testing.T) {
	for _, required := range []string{"CREATE TABLE IF NOT EXISTS", "chemdb.table_activation", "scope TEXT PRIMARY KEY"} {
		if !strings.Contains(tableActivationSchemaCQL, required) {
			t.Fatalf("activation startup schema must contain %q: %q", required, tableActivationSchemaCQL)
		}
	}
	if !strings.Contains(activateReadyTableCQL, "IF is_ok = true") {
		t.Fatal("activation must check the target readiness with an LWT")
	}
	if !strings.Contains(updateActivePointerCQL, "IF lock_token = ?") {
		t.Fatal("the single active pointer must change only under the serialized lock")
	}
	if strings.Count(activateReadyTableCQL, "?") != 1 || strings.Count(updateActivePointerCQL, "?") != 3 {
		t.Fatal("activation LWT values must remain parameterized")
	}
}

func TestActivationLeaseAcquisitionGuardsTheObservedPointer(t *testing.T) {
	if !strings.Contains(acquireTableActivationLockCQL, "IF lock_token = ? AND active_created_at = ?") {
		t.Fatal("activation lease must not be acquired from a stale active-pointer read")
	}
	if strings.Count(acquireTableActivationLockCQL, "?") != 5 {
		t.Fatal("activation lease values must remain parameterized")
	}
}
