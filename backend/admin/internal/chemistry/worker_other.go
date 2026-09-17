//go:build rdkit && cgo && !linux

package chemistry

import "os/exec"

func configureWorkerProcess(cmd *exec.Cmd) {}
