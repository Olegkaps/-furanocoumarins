//go:build rdkit && cgo && linux

package chemistry

import (
	"context"
	"errors"
	"syscall"
	"testing"
	"time"
)

func TestFingerprintBuildTimeoutAndRecovery(t *testing.T) {
	// Suspend the actual native worker to simulate constrained CPU scheduling.
	// Reserve the other slot so requests must use this worker or its replacement.
	spare := <-workerPool
	previous := <-workerPool
	if previous != nil {
		previous.stop()
	}
	t.Cleanup(func() {
		current := <-workerPool
		if current != nil {
			current.stop()
		}
		workerPool <- nil
		workerPool <- spare
	})
	w, err := startWorker()
	if err != nil {
		workerPool <- nil
		t.Fatal(err)
	}
	workerPool <- w
	if err = syscall.Kill(w.cmd.Process.Pid, syscall.SIGSTOP); err != nil {
		t.Fatal(err)
	}
	resumed := make(chan error, 1)
	go func() {
		time.Sleep(workerTimeout + 200*time.Millisecond)
		resumed <- syscall.Kill(w.cmd.Process.Pid, syscall.SIGCONT)
	}()
	features, err := FingerprintsWithTimeout(context.Background(), []string{"CO", "CN"}, 10*time.Second)
	if resumeErr := <-resumed; resumeErr != nil {
		t.Fatal(resumeErr)
	}
	if err != nil || len(features) != 2 || !features[0].Valid || !features[1].Valid {
		t.Fatalf("background batch should survive interactive timeout: %v %v", features, err)
	}
	if err = syscall.Kill(w.cmd.Process.Pid, syscall.SIGSTOP); err != nil {
		t.Fatal(err)
	}
	// Interactive fingerprint requests retain the three-second deadline.
	if _, err = Fingerprints(context.Background(), []string{"CO"}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("interactive deadline: %v", err)
	}
	if err = syscall.Kill(w.cmd.Process.Pid, 0); err == nil {
		t.Fatal("timed-out worker was not killed and reaped")
	}
	// A canceled caller still prevents a build request.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = FingerprintsWithTimeout(ctx, []string{"CO"}, time.Minute); !errors.Is(err, context.Canceled) {
		t.Fatalf("caller cancellation: %v", err)
	}
	features, err = FingerprintsWithTimeout(context.Background(), []string{"CO"}, 10*time.Second)
	if err != nil || len(features) != 1 || !features[0].Valid {
		t.Fatalf("replacement worker: %v %v", features, err)
	}
}
