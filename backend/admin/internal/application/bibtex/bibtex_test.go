package bibtex_test

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/exp/slices"

	appbibtex "admin/internal/application/bibtex"
)

func fiberCtx(t *testing.T) *fiber.Ctx {
	t.Helper()
	app := fiber.New()
	var ctx *fiber.Ctx
	app.Get("/", func(c *fiber.Ctx) error {
		ctx = c
		return c.SendStatus(fiber.StatusOK)
	}).Name("test")
	_, err := app.Test(httptest.NewRequest("GET", "/", nil))
	require.NoError(t, err)
	require.NotNil(t, ctx)
	return ctx
}

func TestCheckArticleIDsPositive(t *testing.T) {
	warnings := appbibtex.CheckArticleIDs(
		map[string]string{"a": "1", "b": "2"},
		[]string{"a", "b"},
	)
	assert.Empty(t, warnings)
}

func TestCheckArticleIDsNegative(t *testing.T) {
	warnings := appbibtex.CheckArticleIDs(
		map[string]string{"a": "1"},
		[]string{"a", "missing"},
	)
	slices.Sort(warnings)
	assert.Equal(t, []string{"missing article id 'missing'"}, warnings)
}

func TestParseBibtexFilePositive(t *testing.T) {
	body := `@article{key1,
  title = {Hello},
}
@book{key2,
  title = {World},
}`
	file := multipartFile(t, body)
	ids, err := appbibtex.ParseBibtexFile(fiberCtx(t), file)
	require.NoError(t, err)
	assert.Contains(t, ids, "key1")
	assert.Contains(t, ids, "key2")
}

func TestParseBibtexFileNegativeEmpty(t *testing.T) {
	file := multipartFile(t, "")
	ids, err := appbibtex.ParseBibtexFile(fiberCtx(t), file)
	require.NoError(t, err)
	assert.Empty(t, ids)
}

func runParseInsideFiber(t *testing.T, body string) (map[string]string, error) {
	t.Helper()
	app := fiber.New()
	var ids map[string]string
	var parseErr error
	app.Post("/", func(c *fiber.Ctx) error {
		ids, parseErr = appbibtex.ParseBibtexFile(c, multipartFile(t, body))
		return c.SendStatus(fiber.StatusOK)
	}).Name("test")
	_, err := app.Test(httptest.NewRequest("POST", "/", nil))
	require.NoError(t, err)
	return ids, parseErr
}

func TestParseBibtexFileDuplicateKeyPositive(t *testing.T) {
	body := `@article{dup,
  title = {First},
}
@book{dup,
  title = {Second},
}`
	ids, err := runParseInsideFiber(t, body)
	require.NoError(t, err)
	assert.Contains(t, ids, "dup")
}

func TestParseBibtexFileContinuationLinesPositive(t *testing.T) {
	body := `@article{key1,
  author = {Alice},
  title = {Hello},
}`
	file := multipartFile(t, body)
	ids, err := appbibtex.ParseBibtexFile(fiberCtx(t), file)
	require.NoError(t, err)
	assert.Contains(t, ids["key1"], "author = {Alice}")
}

func TestParseBibtexFileSecondEntryReplacesStackPositive(t *testing.T) {
	body := `@article{a, x=1}
@book{b, y=2}`
	file := multipartFile(t, body)
	ids, err := appbibtex.ParseBibtexFile(fiberCtx(t), file)
	require.NoError(t, err)
	assert.Contains(t, ids, "a")
	assert.Contains(t, ids, "b")
}

type errOnCloseFile struct {
	*bytes.Reader
	closeErr error
}

func (f *errOnCloseFile) Close() error { return f.closeErr }

func TestParseBibtexFileCloseErrorNegative(t *testing.T) {
	app := fiber.New()
	var ids map[string]string
	var parseErr error
	app.Post("/", func(c *fiber.Ctx) error {
		file := &errOnCloseFile{Reader: bytes.NewReader([]byte(`@article{k,}`)), closeErr: assert.AnError}
		ids, parseErr = appbibtex.ParseBibtexFile(c, file)
		return c.SendStatus(fiber.StatusOK)
	}).Name("test")
	_, err := app.Test(httptest.NewRequest("POST", "/", nil))
	require.NoError(t, err)
	require.NoError(t, parseErr)
	assert.Contains(t, ids, "k")
}

func multipartFile(t *testing.T, content string) multipart.File {
	t.Helper()
	r := bytes.NewReader([]byte(content))
	return &struct {
		*bytes.Reader
		io.Closer
	}{Reader: r, Closer: io.NopCloser(bytes.NewReader(nil))}
}
