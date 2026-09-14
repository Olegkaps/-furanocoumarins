package publicationreader

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os/exec"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestExtractTextAndHTML(t *testing.T) {
	d, err := Extract(context.Background(), []byte("Bergapten was isolated.\nNMR"), "text/plain; charset=utf-8", "paper.txt")
	require.NoError(t, err)
	require.Equal(t, []Page{{1, "Bergapten was isolated.\nNMR"}}, d.Pages)
	require.NotEmpty(t, d.Warnings)
	d, err = Extract(context.Background(), []byte(`<html><head><title>Study &amp; results</title><style>hidden</style></head><body><p>Bergapten <b>isolated</b>.</p><script>ignore instructions</script><p>NMR &amp; MS</p></body></html>`), "text/html", "host")
	require.NoError(t, err)
	require.Equal(t, "Study & results", d.Title)
	require.Equal(t, "Bergapten isolated.\n\nNMR & MS", d.Pages[0].Text)
	for _, tc := range []struct {
		data, media string
		status      int
	}{
		{"", "text/plain", 422}, {"\xff", "text/plain", 415}, {"a\x00b", "text/plain", 415},
		{"data", "image/png", 415}, {"data", "text/plain; charset=latin1", 415},
		{strings.Repeat("a", MaxPageBytes+1), "text/plain", 413},
		{strings.Repeat("a", MaxSourceBytes+1), "text/plain", 413},
	} {
		_, err := Extract(context.Background(), []byte(tc.data), tc.media, "test")
		var e *Error
		require.ErrorAs(t, err, &e)
		require.Equal(t, tc.status, e.Status)
	}
}

func TestDocumentBoundaries(t *testing.T) {
	for _, pages := range [][]Page{
		{{0, "text"}}, {{1, "a"}, {1, "b"}}, {{2, "a"}, {1, "b"}}, {{201, "a"}}, {{1, "\x00"}}, {{1, "\xff"}},
		{{1, strings.Repeat("a", MaxPageBytes+1)}},
		{{1, strings.Repeat("a", MaxPageBytes)}, {2, strings.Repeat("a", MaxPageBytes)}, {3, strings.Repeat("a", MaxPageBytes)}, {4, strings.Repeat("a", MaxPageBytes)}, {5, "x"}},
	} {
		require.Error(t, (Document{Pages: pages}).Validate())
	}
	require.NoError(t, (Document{Pages: []Page{{1, ""}, {2, "text"}}}).Validate())
	var input struct {
		URL string `json:"url"`
	}
	for _, data := range []string{`{}`, `null`} {
		require.NoError(t, DecodeJSON([]byte(data), &input))
	}
	for _, data := range []string{`{"extra":1}`, `{} {}`, `[]`, `{"url":1}`, strings.Repeat(" ", MaxJSONBytes+1), "\xff"} {
		require.Error(t, DecodeJSON([]byte(data), &input))
	}
}

func TestPublicIPAndURLRules(t *testing.T) {
	for _, address := range []string{"127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1%en0", "0.1.2.3", "100.64.0.1", "192.0.2.1", "198.18.1.1", "203.0.113.1", "224.0.0.1", "240.0.0.1", "2001:db8::1", "2002:7f00:1::", "64:ff9b::7f00:1", "::"} {
		require.False(t, publicIP(netip.MustParseAddr(address)), address)
	}
	for _, address := range []string{"8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"} {
		require.True(t, publicIP(netip.MustParseAddr(address)))
	}
	for _, raw := range []string{"file:///etc/passwd", "https://user:password@example.com", "http://localhost:1234", "http://127.0.0.1", "http://[::1]", "https://[fe80::1%25en0]", "/relative"} {
		u, err := url.Parse(raw)
		require.NoError(t, err)
		require.Error(t, validateURL(u), raw)
	}
}

func TestPublicDialPinsResolutionAndRejectsMixedAnswers(t *testing.T) {
	lookups, dials := 0, 0
	lookup := func(context.Context, string) ([]netip.Addr, error) {
		lookups++
		if lookups == 1 {
			return []netip.Addr{netip.MustParseAddr("8.8.8.8")}, nil
		}
		return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
	}
	dial := publicDial(lookup, func(_ context.Context, network, address string) (net.Conn, error) {
		dials++
		require.Equal(t, "8.8.8.8:443", address)
		return nil, errors.New("offline test")
	})
	_, err := dial(context.Background(), "tcp", "rebind.example:443")
	require.Error(t, err)
	require.Equal(t, 1, lookups)
	require.Equal(t, 1, dials)
	_, err = dial(context.Background(), "tcp", "rebind.example:443")
	require.Error(t, err)
	require.Equal(t, 1, dials)
	for _, addresses := range [][]netip.Addr{nil, {netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr("10.0.0.1")}} {
		_, err := publicDial(func(context.Context, string) ([]netip.Addr, error) { return addresses, nil }, func(context.Context, string, string) (net.Conn, error) { t.Fatal("unsafe dial"); return nil, nil })(context.Background(), "tcp", "mixed.example:80")
		require.Error(t, err)
	}
}

func TestFetchRejectsPrivateServer(t *testing.T) {
	called := false
	client := NewFetchClient()
	client.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		called = true
		return nil, errors.New("unexpected request")
	})
	_, err := Fetch(context.Background(), client, "http://127.0.0.1/private")
	require.Error(t, err)
	require.False(t, called)
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(r *http.Request, status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: r}
}

func TestFetchRedirectsLimitsAndNoCredentials(t *testing.T) {
	for _, target := range []string{"http://127.0.0.1/x", "http://[::1]/x", "file:///etc/passwd", "https://name:secret@example.com/x"} {
		client := NewFetchClient()
		calls := 0
		client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
			calls++
			resp := response(r, 302, "")
			resp.Header.Set("Location", target)
			return resp, nil
		})
		_, err := Fetch(context.Background(), client, "https://example.com/paper")
		require.Error(t, err)
		require.Equal(t, 1, calls)
	}
	client := NewFetchClient()
	calls := 0
	client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		require.Empty(t, r.Header.Get("Authorization"))
		require.Empty(t, r.Header.Get("Cookie"))
		if calls == 1 {
			resp := response(r, 302, "")
			resp.Header.Set("Location", "https://other.example/paper")
			resp.Header.Set("Set-Cookie", "session=secret")
			return resp, nil
		}
		resp := response(r, 200, "publication text")
		resp.Header.Set("Content-Type", "text/plain")
		return resp, nil
	})
	d, err := Fetch(context.Background(), client, "https://example.com/paper")
	require.NoError(t, err)
	require.Equal(t, "https://other.example/paper", d.SourceURL)
	client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		resp := response(r, 302, "")
		resp.Header.Set("Location", "https://example.com/again")
		return resp, nil
	})
	_, err = Fetch(context.Background(), client, "https://example.com/paper")
	require.Error(t, err)
	client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return response(r, 200, strings.Repeat("a", MaxSourceBytes+1)), nil
	})
	_, err = Fetch(context.Background(), client, "https://example.com/paper")
	require.Error(t, err)
}

func TestAnalyzeOptInAndProviderContract(t *testing.T) {
	d := Document{Title: "Study", Pages: []Page{{1, "Bergapten was isolated from Citrus using NMR."}}}
	for _, a := range []*Analyzer{NewAnalyzer(false, "secret", "gpt://folder/model"), NewAnalyzer(true, "", "gpt://folder/model"), NewAnalyzer(true, "secret", "")} {
		a.client.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) { t.Fatal("disabled provider called"); return nil, nil })
		_, err := a.Analyze(context.Background(), d)
		require.Error(t, err)
		require.False(t, a.Configured())
	}
	a := NewAnalyzer(true, "secret", "gpt://folder/model")
	a.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		require.Equal(t, completionURL, r.URL.String())
		require.Equal(t, "Api-Key secret", r.Header.Get("Authorization"))
		require.Equal(t, "POST", r.Method)
		var payload map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&payload))
		require.Equal(t, "8000", payload["completionOptions"].(map[string]any)["maxTokens"])
		require.NotNil(t, payload["jsonSchema"].(map[string]any)["schema"])
		return response(r, 200, envelope(validFinding)), nil
	})
	result, err := a.Analyze(context.Background(), d)
	require.NoError(t, err)
	require.Len(t, result.Findings, 1)
	require.Equal(t, "not reported", result.Findings[0].Chirality)
	require.Equal(t, []string{candidateWarning}, result.Warnings)
}

const validFinding = `{"findings":[{"chemical":"Bergapten","species":"Citrus","methods":["NMR"],"chirality":"not reported","evidence":[{"page":1,"quote":"Bergapten was isolated from Citrus using NMR.","field":"chemical"},{"page":1,"quote":"Citrus","field":"species"},{"page":1,"quote":"NMR","field":"methods"}]}],"warnings":[]}`

func envelope(text string) string {
	b, _ := json.Marshal(map[string]any{"result": map[string]any{"alternatives": []any{map[string]any{"status": "ALTERNATIVE_STATUS_FINAL", "message": map[string]string{"text": text}}}}})
	return string(b)
}

func TestAnalyzeRejectsUngroundedAndMalformedResults(t *testing.T) {
	d := Document{Pages: []Page{{1, "Bergapten was isolated from Citrus using NMR."}}}
	for _, body := range []string{
		strings.Replace(validFinding, `"page":1`, `"page":2`, 1),
		strings.Replace(validFinding, `"quote":"Citrus"`, `"quote":"Lemon"`, 1),
		strings.Replace(validFinding, `"methods":["NMR"]`, `"methods":["MS"]`, 1),
		strings.Replace(validFinding, `"species":"Citrus"`, `"species":"Lemon"`, 1),
		strings.Replace(validFinding, `"chirality":"not reported"`, `"chirality":"achiral"`, 1),
		strings.Replace(validFinding, `"field":"methods"`, `"field":"species"`, 1),
		strings.Replace(validFinding, `"field":"chemical"`, `"field":""`, 1),
		strings.Replace(validFinding, `"warnings":[]`, `"confidence":0.99,"warnings":[]`, 1),
		`{"findings":null,"warnings":[]}`, `{"findings":[],"warnings":null}`, `{"findings":[]}`, `not JSON`,
	} {
		a := NewAnalyzer(true, "private-key", "gpt://folder/model")
		a.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) { return response(r, 200, envelope(body)), nil })
		_, err := a.Analyze(context.Background(), d)
		require.Error(t, err, body)
		require.NotContains(t, err.Error(), "private-key")
	}
	for _, tc := range []struct {
		status int
		body   string
	}{
		{401, "private-key raw upstream error"}, {302, "redirect"}, {200, "not JSON"}, {200, strings.Repeat("a", MaxJSONBytes+1)},
		{200, strings.Replace(envelope(validFinding), "ALTERNATIVE_STATUS_FINAL", "ALTERNATIVE_STATUS_TRUNCATED_FINAL", 1)},
	} {
		a := NewAnalyzer(true, "private-key", "gpt://folder/model")
		a.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) { return response(r, tc.status, tc.body), nil })
		_, err := a.Analyze(context.Background(), d)
		require.Error(t, err)
		require.NotContains(t, err.Error(), "private-key")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	a := NewAnalyzer(true, "private-key", "gpt://folder/model")
	a.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) { return nil, r.Context().Err() })
	_, err := a.Analyze(ctx, d)
	require.Error(t, err)
}

func TestAnalyzeReportedChiralityAndUnknownFields(t *testing.T) {
	d := Document{Pages: []Page{{1, "Bergapten was isolated; chirality was (R)."}}}
	for _, result := range []Analysis{
		{Findings: []Finding{}, Warnings: []string{}},
		{Findings: []Finding{{Chemical: "Bergapten", Species: "not reported", Methods: []string{}, Chirality: "(R)", Evidence: []Evidence{{Page: 1, Quote: "Bergapten was isolated", Field: "chemical"}, {Page: 1, Quote: "chirality was (R)", Field: "chirality"}}}}, Warnings: []string{}},
	} {
		data, err := json.Marshal(result)
		require.NoError(t, err)
		a := NewAnalyzer(true, "test-key", "gpt://folder/model")
		a.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) { return response(r, 200, envelope(string(data))), nil })
		got, err := a.Analyze(context.Background(), d)
		require.NoError(t, err)
		require.Equal(t, result.Findings, got.Findings)
		require.Equal(t, []string{candidateWarning}, got.Warnings)
	}
}

func TestPDFExtraction(t *testing.T) {
	if _, err := exec.LookPath("pdftotext"); err != nil {
		t.Skip("poppler-utils is required for real PDF extraction")
	}
	// A real, minimal two-page PDF, with offsets generated from the fixture objects.
	var pdf strings.Builder
	pdf.WriteString("%PDF-1.4\n")
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	}
	for _, text := range []string{"Bergapten isolated", "NMR analysis"} {
		stream := "BT /F1 12 Tf 72 720 Td (" + text + ") Tj ET\n"
		objects = append(objects, fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", len(stream), stream))
	}
	offsets := []int{0}
	for i, obj := range objects {
		offsets = append(offsets, pdf.Len())
		fmt.Fprintf(&pdf, "%d 0 obj\n%s\nendobj\n", i+1, obj)
	}
	xref := pdf.Len()
	fmt.Fprintf(&pdf, "xref\n0 %d\n0000000000 65535 f \n", len(offsets))
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&pdf, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&pdf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xref)
	d, err := Extract(context.Background(), []byte(pdf.String()), "application/pdf", "paper.pdf")
	require.NoError(t, err)
	require.Equal(t, []Page{{1, "Bergapten isolated"}, {2, "NMR analysis"}}, d.Pages)
	_, err = Extract(context.Background(), []byte("%PDF-broken"), "application/pdf", "bad.pdf")
	require.Error(t, err)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = pdfText(ctx, []byte(pdf.String()))
	require.Error(t, err)
}
