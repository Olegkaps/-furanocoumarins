//go:build !rdkit || !cgo

package chemistry

import "context"

type Index struct{}

func NewIndex(_ []string) (*Index, error) { return nil, ErrUnavailable }
func (i *Index) Search(_ context.Context, _ string, _ Options, _ int) ([]string, error) {
	return nil, ErrUnavailable
}
func (i *Index) Close() {}

func NewIndexContext(_ context.Context, _ []string) (*Index, error) { return nil, ErrUnavailable }

type WorkerIndex = Index

func NewWorkerIndex(_ context.Context, _ []string) (*WorkerIndex, error) { return nil, ErrUnavailable }

func Fingerprints(context.Context, []string) ([]Fingerprint, error) { return nil, ErrUnavailable }
func QueryFingerprint(context.Context, string, Options) (Fingerprint, error) {
	return Fingerprint{}, ErrUnavailable
}
