package publicationreader

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestPDFAdmissionSaturationAndRelease(t *testing.T) {
	// A local executable exercises real process startup/cancellation without Poppler.
	dir := t.TempDir()
	started := filepath.Join(dir, "started")
	require.NoError(t, os.WriteFile(filepath.Join(dir, "pdftotext"), []byte(`#!/bin/sh
IFS= read -r mode
case "$mode" in
  %PDF-block) printf ready > "$PUBLICATION_READER_TEST_STARTED"; exec /bin/sleep 30 ;;
  %PDF-error) exit 1 ;;
  *) printf 'extracted text\f' ;;
esac
`), 0700))
	t.Setenv("PATH", dir)
	t.Setenv("PUBLICATION_READER_TEST_STARTED", started)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := Extract(ctx, []byte("%PDF-block\n"), "application/pdf", "held.pdf")
		done <- err
	}()
	finished := false
	t.Cleanup(func() {
		cancel()
		if !finished {
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Error("PDF process did not stop")
			}
		}
	})
	require.Eventually(t, func() bool { _, err := os.Stat(started); return err == nil }, 5*time.Second, 10*time.Millisecond)

	assertStatus := func(err error, status int) {
		t.Helper()
		var e *Error
		require.ErrorAs(t, err, &e)
		require.Equal(t, status, e.Status)
	}
	start := time.Now()
	_, err := Extract(context.Background(), []byte("%PDF-ok\n"), "application/pdf", "upload.pdf")
	assertStatus(err, 503)
	client := NewFetchClient()
	client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return response(r, 200, "%PDF-ok\n"), nil
	})
	_, err = Fetch(context.Background(), client, "https://example.com/paper.pdf")
	assertStatus(err, 503)
	require.Less(t, time.Since(start), time.Second, "saturated PDF admission must not wait")
	_, err = Extract(context.Background(), []byte("plain text"), "text/plain", "paper.txt")
	require.NoError(t, err, "a busy PDF slot must not block text extraction")

	cancel()
	select {
	case err = <-done:
		finished = true
		assertStatus(err, 504)
	case <-time.After(5 * time.Second):
		t.Fatal("PDF cancellation did not finish")
	}
	assertAvailable := func() {
		t.Helper()
		doc, err := Extract(context.Background(), []byte("%PDF-ok\n"), "application/pdf", "paper.pdf")
		require.NoError(t, err)
		require.Equal(t, []Page{{1, "extracted text"}}, doc.Pages)
	}
	assertAvailable()
	_, err = pdfText(context.Background(), []byte("%PDF-error\n"))
	assertStatus(err, 422)
	assertAvailable()
	_, err = pdfText(ctx, []byte("%PDF-ok\n"))
	assertStatus(err, 504)
	assertAvailable()
	t.Run("missing executable releases slot", func(t *testing.T) {
		t.Setenv("PATH", t.TempDir())
		_, err := pdfText(context.Background(), []byte("%PDF-ok\n"))
		assertStatus(err, 503)
	})
	assertAvailable()
}
