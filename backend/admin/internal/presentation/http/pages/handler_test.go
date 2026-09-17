package pages

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidateAboutPagesPreservesUsableCatalogsAndRejectsAmbiguousStorageNames(t *testing.T) {
	require.NoError(t, validateAboutPages([]AboutPage{{ID: "methods-2026", Name: "Methods", Icon: "flask"}}))
	require.Error(t, validateAboutPages([]AboutPage{{ID: "same", Name: "One"}, {ID: "same", Name: "Two"}}))
	require.Error(t, validateAboutPages([]AboutPage{{ID: "../../pages", Name: "Unsafe"}}))
	require.Error(t, validateAboutPages([]AboutPage{{ID: "unsafe-icon", Name: "Unsafe", Icon: "arbitrary"}}))

	tooMany := make([]AboutPage, 16)
	for i := range tooMany {
		tooMany[i] = AboutPage{ID: fmt.Sprintf("page-%d", i), Name: "Page", Icon: "info"}
	}
	require.Error(t, validateAboutPages(tooMany))
}
