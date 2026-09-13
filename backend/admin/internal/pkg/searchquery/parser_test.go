package searchquery

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPrecedenceAndNestedGroups(t *testing.T) {
	e, err := Parse("a = '1' OR b = '2' AND c = '3'")
	require.NoError(t, err)
	assert.Equal(t, "OR", e.Operator)
	assert.Equal(t, "a", e.Left.Column)
	assert.Equal(t, "AND", e.Right.Operator)
	e, err = Parse("((a='1' OR b='2') AND (c='3' OR (d='4' AND e='5')))")
	require.NoError(t, err)
	assert.Equal(t, "AND", e.Operator)
	assert.Equal(t, "OR", e.Left.Operator)
	assert.Equal(t, "OR", e.Right.Operator)
	assert.Equal(t, "AND", e.Right.Right.Operator)
}

func TestComparisonsAndLiteralValues(t *testing.T) {
	for _, op := range []string{"=", "!=", "<", ">", "<=", ">=", "LIKE", "CONTAINS"} {
		t.Run(op, func(t *testing.T) {
			e, err := Parse("name " + op + " 'O''Brien `AND` OR (LIKE CONTAINS) ; -- \\\n世界'")
			require.NoError(t, err)
			assert.Equal(t, op, e.Operator)
			assert.Equal(t, "O'Brien `AND` OR (LIKE CONTAINS) ; -- \\\n世界", e.Value)
		})
	}
	e, err := Parse("\t name = '' \n")
	require.NoError(t, err)
	assert.Empty(t, e.Value)
}

func TestMalformedSearch(t *testing.T) {
	for _, raw := range []string{
		"", " ", "()", "(name='a'", "name='a')", "name='a' (name='b')",
		"name='a' name='b'", "name='a' AND", "OR name='a'", "name='a' OR ()",
		"name='a' AND OR name='b'", "name='a' OROR name='b'", "name='a' ANDname='b'",
		"name='unterminated", "name='a'b'", "name='a' OR 1=1", "name='a'; DROP TABLE x; --",
		"name='a' --", "name='a' /*comment*/", "name IN ('a')", "NOT name='a'",
		"name == 'a'", "name <> 'a'", "name = 12", "name = null", "name = `a`",
		"`name`='a'", "schema.name='a'", "name like 'a'", "name='a' or name='b'",
		"name='\x00'", "select='a'",
	} {
		t.Run(raw, func(t *testing.T) {
			_, err := Parse(raw)
			require.Error(t, err)
		})
	}
}

func TestSearchLimits(t *testing.T) {
	for _, tc := range []struct{ name, at, over string }{
		{"bytes", "a='" + strings.Repeat("x", MaxBytes-4) + "'", "a='" + strings.Repeat("x", MaxBytes-3) + "'"},
		{"nesting", strings.Repeat("(", MaxDepth) + "a='x'" + strings.Repeat(")", MaxDepth), strings.Repeat("(", MaxDepth+1) + "a='x'" + strings.Repeat(")", MaxDepth+1)},
		{"comparisons", strings.Repeat("a='x' OR ", MaxComparisons-1) + "a='x'", strings.Repeat("a='x' AND ", MaxComparisons) + "a='x'"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse(tc.at)
			require.NoError(t, err)
			_, err = Parse(tc.over)
			require.Error(t, err)
		})
	}
}
