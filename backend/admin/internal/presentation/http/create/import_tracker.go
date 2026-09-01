package create

import (
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

type importState string

const (
	importing importState = "importing"
	ready     importState = "ready"
	broken    importState = "broken"

	importJobRetention      = time.Hour
	maxCompletedImportJobs  = 128
	maxImportJobNameBytes   = 256
)

type importJob struct {
	ID          string      `json:"import_id"`
	Name        string      `json:"name"`
	State       importState `json:"state"`
	StartedAt   time.Time   `json:"started_at"`
	CompletedAt *time.Time  `json:"completed_at,omitempty"`
}

type importTracker struct {
	mu   sync.RWMutex
	jobs map[string]importJob
	now  func() time.Time
}

func newImportTracker() *importTracker {
	return &importTracker{jobs: make(map[string]importJob), now: time.Now}
}

func boundedImportJobName(name string) string {
	name = strings.ToValidUTF8(name, "")
	if len(name) <= maxImportJobNameBytes {
		return name
	}
	name = name[:maxImportJobNameBytes]
	for !utf8.ValidString(name) {
		_, size := utf8.DecodeLastRuneInString(name)
		if size == 0 {
			return ""
		}
		name = name[:len(name)-size]
	}
	return name
}

func (t *importTracker) pruneLocked(now time.Time) {
	completed := make([]importJob, 0, len(t.jobs))
	for id, job := range t.jobs {
		if job.State == importing || job.CompletedAt == nil {
			continue
		}
		if now.Sub(*job.CompletedAt) > importJobRetention {
			delete(t.jobs, id)
			continue
		}
		completed = append(completed, job)
	}
	if len(completed) <= maxCompletedImportJobs {
		return
	}
	sort.Slice(completed, func(i, j int) bool {
		if completed[i].CompletedAt.Equal(*completed[j].CompletedAt) {
			return completed[i].ID < completed[j].ID
		}
		return completed[i].CompletedAt.Before(*completed[j].CompletedAt)
	})
	for _, job := range completed[:len(completed)-maxCompletedImportJobs] {
		delete(t.jobs, job.ID)
	}
}

func (t *importTracker) tryStart(name string) (importJob, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.now().UTC()
	t.pruneLocked(now)
	hasRunningImport := false
	for _, job := range t.jobs {
		if job.State == importing {
			hasRunningImport = true
		}
	}
	if hasRunningImport {
		return importJob{}, false
	}
	job := importJob{ID: uuid.NewString(), Name: boundedImportJobName(name), State: importing, StartedAt: now}
	t.jobs[job.ID] = job
	return job, true
}

func (t *importTracker) finish(id string, state importState) {
	if state != ready && state != broken {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	job, ok := t.jobs[id]
	if !ok || job.State != importing {
		return
	}
	now := t.now().UTC()
	job.State = state
	job.CompletedAt = &now
	t.jobs[id] = job
	t.pruneLocked(now)
}

func (t *importTracker) discard(id string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.jobs, id)
}

func (t *importTracker) get(id string) (importJob, bool) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	job, ok := t.jobs[id]
	return job, ok
}
