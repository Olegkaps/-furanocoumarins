// Package chemistry provides native RDKit substructure matching for search and autocomplete.
package chemistry

import "errors"

type Options struct {
	BondOrder        bool `json:"bond_order"`
	AllowHeteroAtoms bool `json:"allow_hetero_atoms"`
	Stereochemistry  bool `json:"stereochemistry"`
}

var ErrUnavailable = errors.New("substructure search requires an RDKit-enabled backend")
var ErrInvalidSMILES = errors.New("invalid or oversized SMILES")
var ErrClosed = errors.New("chemistry index is closed")
var ErrBusy = errors.New("substructure search is busy; retry shortly")

const MaxSMILESBytes = 4096
