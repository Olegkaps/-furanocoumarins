package persistence_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"admin/internal/infrastructure/persistence"
)

func TestString2TimeAcceptsCassandraJSONFractionPrecision(t *testing.T) {
	for _, test := range []struct {
		value      string
		nanosecond int
	}{
		{"2026-08-29T20:52:16Z", 0},
		{"2026-08-29T20:52:16.2Z", 200_000_000},
		{"2026-08-29T20:52:16.20Z", 200_000_000},
		{"2026-08-29T20:52:16.200Z", 200_000_000},
		{"2026-08-29T20:52:16.200123456Z", 200_123_456},
	} {
		t.Run(test.value, func(t *testing.T) {
			parsed, err := persistence.String2Time(nil, test.value)
			require.NoError(t, err)
			require.Equal(t, time.Date(2026, 8, 29, 20, 52, 16, test.nanosecond, time.UTC), parsed)
		})
	}
}
