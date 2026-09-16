package metadata

import "strings"

// IsChemicalNameList recognizes the legacy scalar names column. Its workbook
// delimiter is '=', never commas (which occur inside stereochemical names).
// Physical sets already carry their own member boundaries.
func IsChemicalNameList(column, kind string) bool {
	if column != "names" {
		return false
	}
	chemical := false
	for _, token := range strings.Fields(kind) {
		if token == "set" || strings.HasPrefix(token, "set[") {
			return false
		}
		if token == "chemical" || token == "table_chemical" {
			chemical = true
		}
	}
	return chemical
}

func ChemicalNames(value string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, name := range strings.Split(value, "=") {
		name = strings.Trim(name, " ")
		if name != "" && !seen[name] {
			out = append(out, name)
			seen[name] = true
		}
	}
	return out
}
