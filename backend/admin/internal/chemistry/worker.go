//go:build rdkit && cgo

package chemistry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
	"time"
)

const workerMarker = "--furano-chemistry-worker-v1"
const workerEnvironment = "FURANO_CHEMISTRY_WORKER_V1"
const workerTimeout = 3 * time.Second

// WorkerIndex confines native graph search to a killable process. At most two
// workers exist across all datasets and columns; each caches its latest index.
type WorkerIndex struct {
	mu     sync.RWMutex
	id     uint64
	values []string
	closed bool
}

var nextWorkerIndex atomic.Uint64

type workerRequest struct {
	Fingerprints bool
	Index        uint64
	Values       []string
	Query        string
	Options      Options
	Limit        int
}
type workerReply struct {
	Fingerprints []Fingerprint
	Matches      []string
	Error        string
}
type processWorker struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	encoder *json.Encoder
	decoder *json.Decoder
	index   uint64
}

var workerPool = func() chan *processWorker { c := make(chan *processWorker, 2); c <- nil; c <- nil; return c }()

func NewWorkerIndex(ctx context.Context, values []string) (*WorkerIndex, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(values) > 100000 {
		return nil, fmt.Errorf("too many substructure targets")
	}
	size := 0
	for _, s := range values {
		size += len(s)
		if size > 64<<20 {
			return nil, fmt.Errorf("substructure target data exceeds 64 MiB")
		}
	}
	return &WorkerIndex{id: nextWorkerIndex.Add(1), values: append([]string(nil), values...)}, nil
}
func (i *WorkerIndex) Close() { i.mu.Lock(); defer i.mu.Unlock(); i.closed = true; i.values = nil }

func startWorker() (*processWorker, error) {
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(executable, workerMarker)
	cmd.Env = append(os.Environ(), workerEnvironment+"=1")
	configureWorkerProcess(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		stdin.Close()
		return nil, err
	}
	if err = cmd.Start(); err != nil {
		stdin.Close()
		stdout.Close()
		return nil, err
	}
	return &processWorker{cmd: cmd, stdin: stdin, encoder: json.NewEncoder(stdin), decoder: json.NewDecoder(stdout)}, nil
}
func (w *processWorker) stop() { w.stdin.Close(); _ = w.cmd.Process.Kill(); _ = w.cmd.Wait() }

func (i *WorkerIndex) Search(ctx context.Context, query string, opts Options, limit int) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(query) == 0 || len(query) > MaxSMILESBytes {
		return nil, ErrInvalidSMILES
	}
	if limit < 1 || limit > 100000 {
		return nil, fmt.Errorf("substructure limit must be between 1 and 100000")
	}
	i.mu.RLock()
	defer i.mu.RUnlock()
	if i.closed {
		return nil, ErrClosed
	}
	request := workerRequest{Index: i.id, Query: query, Options: opts, Limit: limit}
	reply, err := runWorker(ctx, request, i.values)
	if err != nil {
		return nil, err
	}
	return reply.Matches, nil
}

func runWorker(ctx context.Context, request workerRequest, values []string) (workerReply, error) {
	// The process timeout also covers index loading, pipe writes and response reads.
	ctx, cancel := context.WithTimeout(ctx, workerTimeout)
	defer cancel()
	var w *processWorker
	select {
	case w = <-workerPool:
	default:
		return workerReply{}, ErrBusy
	}
	defer func() { workerPool <- w }()
	var err error
	if w == nil {
		w, err = startWorker()
		if err != nil {
			return workerReply{}, fmt.Errorf("start chemistry worker: %w", err)
		}
	}
	if !request.Fingerprints && w.index != request.Index {
		request.Values = values
	}
	type result struct {
		reply workerReply
		err   error
	}
	done := make(chan result, 1)
	active := w
	go func() {
		var reply workerReply
		err := active.encoder.Encode(request)
		if err == nil {
			err = active.decoder.Decode(&reply)
		}
		done <- result{reply, err}
	}()
	select {
	case <-ctx.Done():
		w.stop()
		w = nil
		return workerReply{}, ctx.Err()
	case result := <-done:
		if result.err != nil {
			w.stop()
			w = nil
			return workerReply{}, fmt.Errorf("chemistry worker failed: %w", result.err)
		}
		if !request.Fingerprints {
			w.index = request.Index
		}
		switch result.reply.Error {
		case "":
			return result.reply, nil
		case "invalid":
			return workerReply{}, ErrInvalidSMILES
		default:
			return workerReply{}, fmt.Errorf("chemistry worker: %s", result.reply.Error)
		}
	}
}

// The worker entry point is private, local pipe transport only, and activates
// before application initialization in both the server and native test binary.
func init() {
	if os.Getenv(workerEnvironment) != "1" || len(os.Args) != 2 || os.Args[1] != workerMarker {
		return
	}
	decoder := json.NewDecoder(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)
	var index *Index
	var id uint64
	for {
		var request workerRequest
		if err := decoder.Decode(&request); err != nil {
			break
		}
		if request.Fingerprints {
			reply := workerReply{Fingerprints: make([]Fingerprint, len(request.Values))}
			if len(request.Values) > MaxFingerprintBatch {
				reply.Error = "fingerprint batch too large"
			} else {
				for n, value := range request.Values {
					reply.Fingerprints[n] = nativeFingerprint(value)
				}
			}
			if encoder.Encode(reply) != nil {
				break
			}
			continue
		}
		if index == nil || id != request.Index {
			if index != nil {
				index.Close()
			}
			var err error
			index, err = NewIndex(request.Values)
			if err != nil {
				_ = encoder.Encode(workerReply{Error: "index initialization failed"})
				continue
			}
			id = request.Index
		}
		matches, err := index.Search(context.Background(), request.Query, request.Options, request.Limit)
		reply := workerReply{Matches: matches}
		if errors.Is(err, ErrInvalidSMILES) {
			reply.Error = "invalid"
		} else if err != nil {
			reply.Error = "native matching failed"
		}
		if encoder.Encode(reply) != nil {
			break
		}
	}
	if index != nil {
		index.Close()
	}
	os.Exit(0)
}

// Fingerprints parses a bounded batch in a killable native worker. Invalid source
// strings yield Valid=false, preserving positional correspondence with values.
func Fingerprints(ctx context.Context, values []string) ([]Fingerprint, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(values) > MaxFingerprintBatch {
		return nil, fmt.Errorf("fingerprint batch exceeds %d", MaxFingerprintBatch)
	}
	bounded := make([]string, len(values))
	for n, value := range values {
		// Oversized source values are invalid entries, not a failed dataset build.
		if len(value) <= MaxSMILESBytes {
			bounded[n] = value
		}
	}
	if len(values) == 0 {
		return []Fingerprint{}, nil
	}
	reply, err := runWorker(ctx, workerRequest{Fingerprints: true, Values: bounded}, nil)
	if err != nil {
		return nil, err
	}
	if len(reply.Fingerprints) != len(values) {
		return nil, fmt.Errorf("invalid fingerprint worker response")
	}
	return reply.Fingerprints, nil
}

func QueryFingerprint(ctx context.Context, value string, _ Options) (Fingerprint, error) {
	results, err := Fingerprints(ctx, []string{value})
	if err != nil {
		return Fingerprint{}, err
	}
	if !results[0].Valid || results[0].Atoms > 64 {
		return Fingerprint{}, ErrInvalidSMILES
	}
	return results[0], nil
}
