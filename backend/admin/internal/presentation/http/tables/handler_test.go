package tables

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestParseTimestampParamAcceptsPercentEncodedRFC3339(t *testing.T) {
	parsed, err := parseTimestampParam(nil, "2026-08-30T16%3A27%3A44.21Z")
	require.NoError(t, err)
	require.Equal(t, time.Date(2026, 8, 30, 16, 27, 44, 210_000_000, time.UTC), parsed)
}

func TestParseTimestampParamRejectsMalformedEscape(t *testing.T) {
	_, err := parseTimestampParam(nil, "2026-08-30T16%3X27%3A44Z")
	require.Error(t, err)
}
