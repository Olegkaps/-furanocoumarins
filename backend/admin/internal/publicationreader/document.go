package publicationreader

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"os/exec"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/net/html"
)

const (
	MaxSourceBytes = 8 << 20
	MaxJSONBytes   = 1 << 20
	MaxTextBytes   = 160000
	MaxPageBytes   = MaxTextBytes
	MaxPages       = 200
)

type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string                 { return e.Message }
func failure(status int, message string) error { return &Error{status, message} }

type Page struct {
	Number int    `json:"number"`
	Text   string `json:"text"`
}
type Document struct {
	Title     string   `json:"title"`
	Pages     []Page   `json:"pages"`
	SourceURL string   `json:"source_url,omitempty"`
	Warnings  []string `json:"warnings"`
}

func DecodeJSON(data []byte, value any) error {
	if len(data) > MaxJSONBytes {
		return failure(413, "JSON exceeds 1 MiB")
	}
	if !utf8.Valid(data) {
		return failure(400, "JSON must be UTF-8")
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(value) != nil || d.Decode(new(any)) != io.EOF {
		return failure(400, "provide one valid JSON object with supported fields")
	}
	return nil
}

func (d Document) Validate() error {
	if len(d.Title) > 1000 || !utf8.ValidString(d.Title) {
		return failure(400, "invalid document title")
	}
	if len(d.Pages) == 0 {
		return failure(422, "document has no readable text; scanned PDFs require OCR")
	}
	if len(d.Pages) > MaxPages {
		return failure(413, "document exceeds 200 pages")
	}
	total, previous := 0, 0
	for _, p := range d.Pages {
		if p.Number <= previous || p.Number > MaxPages || !utf8.ValidString(p.Text) || strings.ContainsRune(p.Text, 0) {
			return failure(400, "pages require increasing numbers from 1 to 200 and UTF-8 text")
		}
		previous = p.Number
		if len(p.Text) > MaxPageBytes {
			return failure(413, "page exceeds 160000 text bytes")
		}
		total += len(p.Text)
	}
	if total > MaxTextBytes {
		return failure(413, "document exceeds 160000 text bytes")
	}
	for _, p := range d.Pages {
		if strings.TrimSpace(p.Text) != "" {
			return nil
		}
	}
	return failure(422, "document has no readable text; scanned PDFs require OCR")
}

func ReadBounded(r io.Reader, limit int) ([]byte, error) {
	b, err := io.ReadAll(io.LimitReader(r, int64(limit)+1))
	if err != nil {
		return nil, failure(422, "could not read document or response")
	}
	if len(b) > limit {
		return nil, failure(413, "document or response exceeds size limit")
	}
	return b, nil
}

// Uploads and URL reads share one process slot across all handler instances.
var pdfSlot = make(chan struct{}, 1)

// Poppler reads and writes pipes only. Page/output caps and a deadline also apply
// to corrupt PDFs; no publication files are retained on the server.
func pdfText(ctx context.Context, data []byte) ([]byte, error) {
	select {
	case pdfSlot <- struct{}{}:
		defer func() { <-pdfSlot }()
	default:
		return nil, failure(503, "PDF extraction is busy; retry shortly")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "pdftotext", "-f", "1", "-l", strconv.Itoa(MaxPages+1), "-enc", "UTF-8", "-layout", "-", "-")
	cmd.Stdin = bytes.NewReader(data)
	cmd.WaitDelay = time.Second
	out := &limitedOutput{remaining: MaxTextBytes + MaxPages + 1}
	cmd.Stdout = out
	cmd.Stderr = io.Discard
	err := cmd.Run()
	if ctx.Err() != nil {
		return nil, failure(504, "PDF extraction timed out")
	}
	if out.exceeded {
		return nil, failure(413, "PDF text exceeds size limit")
	}
	if errors.Is(err, exec.ErrNotFound) {
		return nil, failure(503, "PDF extraction requires poppler-utils")
	}
	if err != nil {
		return nil, failure(422, "PDF cannot be read; check encryption or file validity")
	}
	return out.Bytes(), nil
}

type limitedOutput struct {
	bytes.Buffer
	remaining int
	exceeded  bool
}

func (w *limitedOutput) Write(p []byte) (int, error) {
	if len(p) > w.remaining {
		w.exceeded = true
		return 0, errors.New("output limit")
	}
	w.remaining -= len(p)
	return w.Buffer.Write(p)
}

func Extract(ctx context.Context, data []byte, contentType, title string) (Document, error) {
	d := Document{Title: title, Pages: []Page{}, Warnings: []string{}}
	if len(data) > MaxSourceBytes {
		return d, failure(413, "source exceeds 8 MiB")
	}
	media, params, _ := mime.ParseMediaType(contentType)
	if bytes.HasPrefix(data, []byte("%PDF-")) {
		text, err := pdfText(ctx, data)
		if err != nil {
			return d, err
		}
		parts := strings.Split(strings.TrimSuffix(string(text), "\f"), "\f")
		for i, part := range parts {
			d.Pages = append(d.Pages, Page{i + 1, strings.TrimSpace(part)})
		}
		d.Warnings = append(d.Warnings, "PDF text extraction may omit images, tables or scanned content; page numbers refer to PDF pages.")
	} else {
		if media != "text/plain" && media != "text/html" {
			return d, failure(415, "supported formats: PDF, UTF-8 text and HTML")
		}
		if charset := strings.ToLower(params["charset"]); charset != "" && charset != "utf-8" && charset != "us-ascii" {
			return d, failure(415, "text and HTML must use UTF-8")
		}
		if !utf8.Valid(data) || bytes.ContainsRune(data, 0) {
			return d, failure(415, "text and HTML must use UTF-8")
		}
		text := string(data)
		if media == "text/html" {
			var htmlTitle string
			text, htmlTitle = htmlText(data)
			if htmlTitle != "" && len(htmlTitle) <= 1000 {
				d.Title = htmlTitle
			}
		}
		d.Pages = []Page{{1, strings.TrimSpace(text)}}
		d.Warnings = append(d.Warnings, "Text/HTML uses one logical page; original publication pagination is unavailable.")
	}
	return d, d.Validate()
}

func htmlText(data []byte) (string, string) {
	z := html.NewTokenizer(bytes.NewReader(data))
	var body, title strings.Builder
	var skip string
	inHead, inTitle := false, false
	for {
		t := z.Next()
		if t == html.ErrorToken {
			break
		}
		token := z.Token()
		if t == html.StartTagToken {
			if token.Data == "head" {
				inHead = true
			}
			if token.Data == "title" {
				inTitle = true
			}
			if token.Data == "script" || token.Data == "style" || token.Data == "template" {
				skip = token.Data
			}
		}
		if t == html.TextToken && skip == "" {
			if inTitle {
				title.WriteString(token.Data)
			} else if !inHead {
				body.WriteString(token.Data)
			}
		}
		if t == html.EndTagToken {
			if token.Data == skip {
				skip = ""
			}
			if token.Data == "head" {
				inHead = false
			}
			if token.Data == "title" {
				inTitle = false
			}
		}
		if skip == "" && !inHead && (t == html.StartTagToken || t == html.EndTagToken || t == html.SelfClosingTagToken) {
			switch token.Data {
			case "p", "br", "div", "li", "tr", "td", "h1", "h2", "h3", "section", "article":
				body.WriteByte('\n')
			}
		}
	}
	return body.String(), strings.TrimSpace(title.String())
}
