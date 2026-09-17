package chemistry

// FingerprintVersion identifies the persisted screening representation. Change
// it whenever feature generation changes so stored fingerprints are rebuilt.
const FingerprintVersion = 3
const MaxFingerprintBatch = 128

// Fingerprint contains necessary (not sufficient) graph features. Unscreenable
// targets must bypass feature filtering; an unscreenable query admits all targets.
// Stereo, isotope, charge and local hydrogen constraints remain exact-match work.
type Fingerprint struct {
	Valid      bool
	Screenable bool
	Modes      [4][]int32
	Atoms      int
	Bonds      int
}

func FingerprintMode(opts Options) int {
	mode := 0
	if opts.BondOrder {
		mode |= 1
	}
	if opts.AllowHeteroAtoms {
		mode |= 2
	}
	return mode
}
