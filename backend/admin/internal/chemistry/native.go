//go:build rdkit && cgo

package chemistry

/*
#cgo CXXFLAGS: -std=c++17 -I/usr/include/rdkit
#cgo LDFLAGS: -lRDKitSmilesParse -lRDKitSubstructMatch -lRDKitGraphMol -lRDKitRDGeneral -lstdc++
#include <stdlib.h>
#include "bridge.h"
*/
import "C"

import (
	"context"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"unsafe"
)

type molecule struct {
	value string
	ptr   unsafe.Pointer
}
type Index struct {
	mu      sync.RWMutex
	targets []molecule
	closed  bool
}

// Bound native scan concurrency across indexes, including during dataset changes.
var scanSlots = make(chan struct{}, 2)

func parse(s string, query bool, opts Options) unsafe.Pointer {
	if len(s) == 0 || len(s) > MaxSMILESBytes || strings.IndexByte(s, 0) >= 0 || strings.ContainsAny(s, " \t\r\n") {
		return nil
	}
	text := C.CString(s)
	defer C.free(unsafe.Pointer(text))
	flag := func(v bool) C.int {
		if v {
			return 1
		}
		return 0
	}
	return C.furano_parse(text, flag(query), flag(opts.BondOrder), flag(opts.AllowHeteroAtoms))
}

// NewIndex caches parsed, unique targets. Invalid source records are excluded;
// their original values remain available through ordinary text autocomplete.
func NewIndex(smiles []string) (*Index, error) {
	return NewIndexContext(context.Background(), smiles)
}

func NewIndexContext(ctx context.Context, smiles []string) (*Index, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	idx := &Index{}
	seen := make(map[string]bool, len(smiles))
	for _, s := range smiles {
		if err := ctx.Err(); err != nil {
			idx.Close()
			return nil, err
		}
		if seen[s] {
			continue
		}
		seen[s] = true
		if p := parse(s, false, Options{}); p != nil {
			idx.targets = append(idx.targets, molecule{s, p})
		}
	}
	if err := ctx.Err(); err != nil {
		idx.Close()
		return nil, err
	}
	runtime.SetFinalizer(idx, (*Index).Close)
	return idx, nil
}
func (i *Index) Close() {
	if i == nil {
		return
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.closed {
		return
	}
	i.closed = true
	for _, m := range i.targets {
		C.furano_free(m.ptr)
	}
	i.targets = nil
	runtime.SetFinalizer(i, nil)
}
func (i *Index) Search(ctx context.Context, query string, opts Options, limit int) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if limit < 1 || limit > 100000 {
		return nil, fmt.Errorf("substructure limit must be between 1 and 100000")
	}
	select {
	case scanSlots <- struct{}{}:
		defer func() { <-scanSlots }()
	default:
		return nil, ErrBusy
	}
	p := parse(query, true, opts)
	if p == nil {
		return nil, ErrInvalidSMILES
	}
	defer C.furano_free(p)
	i.mu.RLock()
	defer i.mu.RUnlock()
	if i.closed {
		return nil, ErrClosed
	}
	results := make([]string, 0, min(limit, len(i.targets)))
	stereo := C.int(0)
	if opts.Stereochemistry {
		stereo = 1
	}
	for _, m := range i.targets {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		matched := C.furano_match(m.ptr, p, stereo)
		if matched < 0 {
			return nil, fmt.Errorf("native substructure matching failed")
		}
		if matched == 1 {
			results = append(results, m.value)
			if len(results) == limit {
				break
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return results, nil
}

func nativeFingerprint(value string) Fingerprint {
	ptr := parse(value, false, Options{})
	if ptr == nil {
		return Fingerprint{}
	}
	defer C.furano_free(ptr)
	result := Fingerprint{Valid: true, Screenable: true, Atoms: int(C.furano_atoms(ptr)), Bonds: int(C.furano_bonds(ptr))}
	buffer := make([]C.int32_t, 8192)
	for mode := range result.Modes {
		count := int(C.furano_fingerprint(ptr, C.int(mode), &buffer[0], C.int(len(buffer))))
		if count < 0 {
			result.Screenable = false
			result.Modes = [4][]int32{}
			return result
		}
		result.Modes[mode] = make([]int32, count)
		for n := 0; n < count; n++ {
			result.Modes[mode][n] = int32(buffer[n])
		}
	}
	return result
}
