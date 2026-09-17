//go:build rdkit && cgo

package chemistry

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestWorkerTimeoutAndRecovery(t *testing.T) {
	// Reserve the other pool slot so recovery must replace this request's worker.
	spare := <-workerPool
	defer func() { workerPool <- spare }()
	idx, err := NewWorkerIndex(context.Background(), []string{strings.Repeat("C", 64), "CCO"})
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	if got, err := idx.Search(context.Background(), "CO", Options{BondOrder: true}, 10); err != nil || len(got) != 1 {
		t.Fatalf("warmup: %v %v", got, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err = idx.Search(ctx, strings.Repeat("C.", 20)+"N", Options{BondOrder: true}, 10)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected deadline, got %v", err)
	}
	if time.Since(started) > 2*time.Second {
		t.Fatal("native work was not killed promptly")
	}
	if got, err := idx.Search(context.Background(), "CO", Options{BondOrder: true}, 10); err != nil || len(got) != 1 {
		t.Fatalf("replacement: %v %v", got, err)
	}
	w := <-workerPool
	if w != nil {
		w.stop()
	}
	workerPool <- nil
}
func TestWorkerProtocolAndIndexSwitch(t *testing.T) {
	spare := <-workerPool
	defer func() { workerPool <- spare }()
	a, _ := NewWorkerIndex(context.Background(), []string{"CCO"})
	defer a.Close()
	b, _ := NewWorkerIndex(context.Background(), []string{"CCN"})
	defer b.Close()
	for _, i := range []*WorkerIndex{a, a, b, b, a} {
		got, err := i.Search(context.Background(), "C", Options{}, 1)
		want := "CCO"
		if i == b {
			want = "CCN"
		}
		if err != nil || len(got) != 1 || got[0] != want {
			t.Fatalf("got %v %v want %s", got, err, want)
		}
	}
	if _, err := a.Search(context.Background(), "not smiles", Options{}, 1); !errors.Is(err, ErrInvalidSMILES) {
		t.Fatal(err)
	}
	a.Close()
	if _, err := a.Search(context.Background(), "C", Options{}, 1); !errors.Is(err, ErrClosed) {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := NewWorkerIndex(ctx, nil); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	w := <-workerPool
	if w != nil {
		w.stop()
	}
	workerPool <- nil
}
