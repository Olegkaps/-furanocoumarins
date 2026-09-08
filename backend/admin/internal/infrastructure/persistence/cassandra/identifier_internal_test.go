package cassandra

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidateColumnDefinitionsAcceptsGeneratedUUIDPositive(t *testing.T) {
	columns, err := validateColumnDefinitions(
		[]string{"uuid UUID", "name TEXT", "tags SET<TEXT>"},
		[]string{"uuid"},
	)
	require.NoError(t, err)
	require.Equal(t, []string{"uuid", "name", "tags"}, columns)
}

func TestValidateColumnDefinitionsRejectsUnknownTypeNegative(t *testing.T) {
	_, err := validateColumnDefinitions([]string{"uuid UUID;DROP"}, []string{"uuid"})
	require.Error(t, err)
}
