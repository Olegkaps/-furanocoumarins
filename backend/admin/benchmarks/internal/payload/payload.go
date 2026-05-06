// Package payload builds deterministic high-entropy blob strings for benchmark rows.
package payload

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
)

// Size is the TEXT payload length used across Cassandra/Redis/Postgres benchmarks.
const Size = 512

// Row returns exactly Size bytes as a string (may not be valid UTF-8).
// Prefer RowBytes for Cassandra blob / Postgres BYTEA columns.
func Row(rowIdx int) string {
	return string(RowBytes(rowIdx))
}

// RowBytes is the raw bytes backing Row.
func RowBytes(rowIdx int) []byte {
	var seed [16]byte
	binary.LittleEndian.PutUint64(seed[0:], uint64(rowIdx)^0x9e3779b97f4a7c15)
	binary.LittleEndian.PutUint64(seed[8:], uint64(rowIdx)<<32|uint64(rowIdx)>>32)
	h := sha256.Sum256(seed[:])
	out := make([]byte, 0, Size)
	for len(out) < Size {
		out = append(out, h[:]...)
		h = sha256.Sum256(h[:])
	}
	return out[:Size]
}

// RedisKey builds a unique Redis key for the given prefix and row index (high
// entropy suffix; avoids sequential numeric keys).
func RedisKey(prefix string, idx int) string {
	h := sha256.Sum256([]byte(fmt.Sprintf("redis-bench:%s:%d", prefix, idx)))
	return fmt.Sprintf("%s%x", prefix, h[:24])
}
