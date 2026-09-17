package cassandra

import (
	"golang.org/x/text/unicode/norm"
	"regexp"
	"strings"
	"unicode"
)

// Extract field values without interpreting field-looking text inside nested
// braces or quotes. Historical bibliography records may omit the entry header.
func bibtexSearchText(text string) string {
	text = strings.TrimSpace(text)
	if strings.HasPrefix(text, "@") {
		if pos := strings.Index(text, ","); pos >= 0 {
			text = text[pos+1:]
		}
	}
	var fields []string
	for p := 0; p < len(text); {
		for p < len(text) && (unicode.IsSpace(rune(text[p])) || text[p] == ',') {
			p++
		}
		start := p
		for p < len(text) && ((text[p] >= 'a' && text[p] <= 'z') || (text[p] >= 'A' && text[p] <= 'Z') || (text[p] >= '0' && text[p] <= '9') || text[p] == '_' || text[p] == '-') {
			p++
		}
		if p == start {
			p++
			continue
		}
		for p < len(text) && unicode.IsSpace(rune(text[p])) {
			p++
		}
		if p >= len(text) || text[p] != '=' {
			continue
		}
		p++
		start = p
		depth := 0
		quoted := false
		for p < len(text) {
			c := text[p]
			if c == '\\' && p+1 < len(text) {
				p += 2
				continue
			}
			if c == '"' && depth == 0 {
				quoted = !quoted
			}
			if !quoted {
				if c == '{' {
					depth++
				}
				if c == '}' {
					if depth == 0 {
						break
					}
					depth--
				}
				if c == ',' && depth == 0 {
					break
				}
			}
			p++
		}
		fields = append(fields, text[start:p])
	}
	return latexPlainText(strings.Join(fields, " "))
}

var latexAccent = regexp.MustCompile(`\\(["'` + "`" + `^~=.uvHckbd])\s*\{?([A-Za-z])\}?`)
var latexCommand = regexp.MustCompile(`\\[A-Za-z]+\s*`)

func latexPlainText(text string) string {
	marks := map[string]string{"\"": "\u0308", "'": "\u0301", "`": "\u0300", "^": "\u0302", "~": "\u0303", "=": "\u0304", ".": "\u0307", "u": "\u0306", "v": "\u030c", "H": "\u030b", "c": "\u0327", "k": "\u0328", "b": "\u0331", "d": "\u0323"}
	text = latexAccent.ReplaceAllStringFunc(text, func(s string) string { m := latexAccent.FindStringSubmatch(s); return m[2] + marks[m[1]] })
	text = strings.NewReplacer(`\ss`, "ß", `\ae`, "æ", `\AE`, "Æ", `\oe`, "œ", `\OE`, "Œ", `\o`, "ø", `\O`, "Ø", `\l`, "ł", `\L`, "Ł").Replace(text)
	text = latexCommand.ReplaceAllString(text, "")
	text = strings.NewReplacer("{", "", "}", "", `\`, "", `"`, "", "#", " ").Replace(text)
	return norm.NFC.String(strings.Join(strings.Fields(text), " "))
}
