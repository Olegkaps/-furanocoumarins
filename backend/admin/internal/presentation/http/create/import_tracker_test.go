package create

import (
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/stretchr/testify/require"
)

func TestImportTrackerReportsOnlyRealTerminalTransitions(t *testing.T) {
	tracker := newImportTracker()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	tracker.now = func() time.Time { return now }
	job, accepted := tracker.tryStart("deterministic")
	require.True(t, accepted)
	require.NotEmpty(t, job.ID)
	require.Equal(t, importing, job.State)
	require.Nil(t, job.CompletedAt)

	tracker.finish(job.ID, importing)
	stillImporting, ok := tracker.get(job.ID)
	require.True(t, ok)
	require.Equal(t, importing, stillImporting.State)

	now = now.Add(time.Second)
	tracker.finish(job.ID, ready)
	finished, ok := tracker.get(job.ID)
	require.True(t, ok)
	require.Equal(t, ready, finished.State)
	require.NotNil(t, finished.CompletedAt)

	tracker.finish(job.ID, broken)
	unchanged, _ := tracker.get(job.ID)
	require.Equal(t, ready, unchanged.State, "a terminal outcome must not be overwritten")
}

func TestImportTrackerExpiresOldTerminalJobsButKeepsRunningJobs(t *testing.T) {
	tracker := newImportTracker()
	now := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	tracker.now = func() time.Time { return now }
	finished, accepted := tracker.tryStart("finished")
	require.True(t, accepted)
	tracker.finish(finished.ID, broken)
	running, accepted := tracker.tryStart("running")
	require.True(t, accepted)
	now = now.Add(time.Hour + time.Second)
	_, accepted = tracker.tryStart("new")
	require.False(t, accepted)
	_, finishedExists := tracker.get(finished.ID)
	_, runningExists := tracker.get(running.ID)
	require.False(t, finishedExists)
	require.True(t, runningExists)
}

func TestImportTrackerAcceptsExactlyOneConcurrentImportAndReleasesTerminalSlot(t *testing.T) {
	tracker := newImportTracker()
	var accepted atomic.Int32
	var acceptedJob importJob
	var acceptedMu sync.Mutex
	var wg sync.WaitGroup
	for range 64 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			job, ok := tracker.tryStart("concurrent")
			if ok {
				accepted.Add(1)
				acceptedMu.Lock()
				acceptedJob = job
				acceptedMu.Unlock()
			}
		}()
	}
	wg.Wait()
	require.Equal(t, int32(1), accepted.Load())
	tracker.finish(acceptedJob.ID, ready)
	_, ok := tracker.tryStart("next")
	require.True(t, ok)
}

func TestImportTrackerBoundsCompletedHistoryAndStoredNames(t *testing.T) {
	tracker := newImportTracker()
	now := time.Date(2026, 8, 30, 12, 0, 0, 0, time.UTC)
	tracker.now = func() time.Time { return now }

	ids := make([]string, 0, maxCompletedImportJobs+17)
	for i := range maxCompletedImportJobs + 17 {
		job, accepted := tracker.tryStart(fmt.Sprintf("completed-%03d", i))
		require.True(t, accepted)
		ids = append(ids, job.ID)
		now = now.Add(time.Millisecond)
		tracker.finish(job.ID, ready)
	}

	tracker.mu.RLock()
	require.Len(t, tracker.jobs, maxCompletedImportJobs)
	tracker.mu.RUnlock()
	_, oldestExists := tracker.get(ids[0])
	latest, latestExists := tracker.get(ids[len(ids)-1])
	require.False(t, oldestExists)
	require.True(t, latestExists)
	require.Equal(t, fmt.Sprintf("completed-%03d", maxCompletedImportJobs+16), latest.Name)

	longName := strings.Repeat("é", maxImportJobNameBytes)
	job, accepted := tracker.tryStart(longName)
	require.True(t, accepted)
	require.LessOrEqual(t, len(job.Name), maxImportJobNameBytes)
	require.True(t, utf8.ValidString(job.Name))
}

func TestImportTrackerDiscardRemovesUnacceptedFailure(t *testing.T) {
	tracker := newImportTracker()
	job, accepted := tracker.tryStart("invalid-before-acceptance")
	require.True(t, accepted)
	tracker.discard(job.ID)
	_, exists := tracker.get(job.ID)
	require.False(t, exists)
	_, accepted = tracker.tryStart("next")
	require.True(t, accepted)
}
