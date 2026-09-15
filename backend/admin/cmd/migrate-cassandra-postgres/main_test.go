package main

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestRequiredRejectsEmpty(t *testing.T) {
	cleanConfig(t)
	t.Setenv("FURANO_CASSANDRA_HOST", "")
	_, err := required("FURANO_CASSANDRA_HOST")
	require.Error(t, err)
}
func TestConfigRequiresBothEndpoints(t *testing.T) {
	cleanConfig(t)
	t.Setenv("FURANO_CASSANDRA_HOST", "cassandra")
	t.Setenv("FURANO_POSTGRES_DSN", "")
	_, err := config()
	require.Error(t, err)
}
