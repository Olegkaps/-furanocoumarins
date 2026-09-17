package pages

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidateAboutPagesPreservesUsableCatalogsAndRejectsAmbiguousStorageNames(t *testing.T) {
	for _, icon := range []string{"info", "chemicals", "species", "references", "methods", "data", "flask"} {
		require.NoError(t, validateAboutPages([]AboutPage{{ID: "methods-2026", Name: "Methods", Icon: icon}}))
	}
	require.Error(t, validateAboutPages([]AboutPage{{ID: "same", Name: "One"}, {ID: "same", Name: "Two"}}))
	require.Error(t, validateAboutPages([]AboutPage{{ID: "../../pages", Name: "Unsafe"}}))
	require.Error(t, validateAboutPages([]AboutPage{{ID: "unsafe-icon", Name: "Unsafe", Icon: "arbitrary"}}))

	tooMany := make([]AboutPage, 16)
	for i := range tooMany {
		tooMany[i] = AboutPage{ID: fmt.Sprintf("page-%d", i), Name: "Page", Icon: "info"}
	}
	require.Error(t, validateAboutPages(tooMany))
}
