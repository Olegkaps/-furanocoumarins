//go:build !rdkit || !cgo

package chemistry

import (
	"context"
	"errors"
	"testing"
)

func TestNativeDependencyFailsExplicitly(t *testing.T) {
	if _, err := NewIndex([]string{"CCO"}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("NewIndex: %v", err)
	}
	if _, err := (&Index{}).Search(context.Background(), "CC", Options{}, 10); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("Search: %v", err)
	}
	(&Index{}).Close()
}
