package cassandra

import (
	"crypto/sha256"
	"fmt"
	"strings"
)

// SourceCatalogName locates the optional unjoined-sheet registry for a dataset.
// Hash fallbacks keep PostgreSQL identifiers below its 63-byte limit.
func SourceCatalogName(data string) string {
	parts := strings.Split(data, ".")
	if len(parts) == 2 && len(parts[1])+8 <= 63 {
		return data + "_sources"
	}
	sum := sha256.Sum256([]byte(data))
	return fmt.Sprintf("chemdb.sources_%x", sum[:16])
}

func SourceTableName(data, virtualName string) string {
	sum := sha256.Sum256([]byte(data + "\x00" + virtualName))
	return fmt.Sprintf("chemdb.source_%x", sum[:16])
}

// ValidateSourceTable prevents corrupt source catalogs from referring to another
// dataset's tables during deletion or migration.
func ValidateSourceTable(data, species, virtualName, physical string) error {
	if virtualName == "classification" && physical == species {
		return nil
	}
	if physical != SourceTableName(data, virtualName) {
		return fmt.Errorf("invalid source table %q for dataset %q sheet %q", physical, data, virtualName)
	}
	return nil
}
