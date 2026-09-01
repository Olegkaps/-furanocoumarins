package create

import (
	"admin/internal/application/create/excel"
	"admin/internal/infrastructure/persistence/cassandra"
	"admin/settings"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"unicode"

	"github.com/xuri/excelize/v2"
)

type columnModifiers struct {
	external, defaultColumn                          string
	classificationLevel, classificationTag           string
	linkTemplate, setChoices                         string
	hasExternal, hasDefaultColumn, hasClassification bool
	hasLink, hasSetChoices                           bool
	tokens                                           map[string]struct{}
}

func (m columnModifiers) hasToken(token string) bool {
	if _, ok := m.tokens[canonicalColumnTypeToken(token)]; ok {
		return true
	}
	// Historical workbooks encode both the table-group marker and the domain
	// marker in one exact token. Recognize only those complete composite labels;
	// modifier arguments containing the same words remain inert.
	if token == "table_" || token == "specie" {
		_, ok := m.tokens["table_specie"]
		if ok {
			return true
		}
	}
	if token == "table_" || token == "chemical" {
		_, ok := m.tokens["table_chemical"]
		return ok
	}
	return false
}

func parseColumnType(columnType string) (columnModifiers, error) {
	modifiers := columnModifiers{tokens: make(map[string]struct{})}
	if strings.TrimSpace(columnType) == "" {
		return modifiers, fmt.Errorf("column type is required")
	}
	for cursor := 0; cursor < len(columnType); {
		for cursor < len(columnType) && isTypeSpace(columnType[cursor]) {
			cursor++
		}
		if cursor == len(columnType) {
			break
		}

		if strings.HasPrefix(columnType[cursor:], "ref[]") && typeBoundary(columnType, cursor+len("ref[]")) {
			modifiers.tokens["ref[]"] = struct{}{}
			cursor += len("ref[]")
			continue
		}

		marker := ""
		for _, candidate := range []string{"external", "default", "clas", "link", "set"} {
			if strings.HasPrefix(columnType[cursor:], candidate+"[") {
				marker = candidate
				break
			}
		}
		if marker == "" {
			start := cursor
			for cursor < len(columnType) && !isTypeSpace(columnType[cursor]) {
				cursor++
			}
			token := columnType[start:cursor]
			if token == "external" || token == "default" || token == "clas" || token == "link" {
				return modifiers, fmt.Errorf("bad type %q: malformed %s[...] modifier", columnType, token)
			}
			if err := cassandra.ValidateTypeToken(token); err != nil {
				return modifiers, fmt.Errorf("bad type %q: %w", columnType, err)
			}
			if token == "set" && modifiers.hasSetChoices {
				return modifiers, fmt.Errorf("bad type %q: set and set[...] cannot be combined", columnType)
			}
			modifiers.tokens[canonicalColumnTypeToken(token)] = struct{}{}
			continue
		}

		argument, next, err := parseTypeArgument(columnType, cursor+len(marker), marker)
		if err != nil {
			return modifiers, err
		}
		cursor = next
		switch marker {
		case "external":
			if modifiers.hasExternal {
				return modifiers, fmt.Errorf("bad type %q: exactly one external[sheet] modifier is allowed", columnType)
			}
			if !typeBoundary(columnType, cursor) {
				return modifiers, fmt.Errorf("bad type %q: malformed external[sheet] modifier", columnType)
			}
			modifiers.external, modifiers.hasExternal = argument, true
		case "default":
			if modifiers.hasDefaultColumn {
				return modifiers, fmt.Errorf("bad type %q: exactly one default[column] modifier is allowed", columnType)
			}
			if !typeBoundary(columnType, cursor) {
				return modifiers, fmt.Errorf("bad type %q: malformed default[column] modifier", columnType)
			}
			if err := cassandra.ValidateIdentifier(argument); err != nil {
				return modifiers, fmt.Errorf("bad type %q: default column: %w", columnType, err)
			}
			modifiers.defaultColumn, modifiers.hasDefaultColumn = argument, true
		case "clas":
			if modifiers.hasClassification {
				return modifiers, fmt.Errorf("bad type %q: exactly one clas[level][tag] modifier is allowed", columnType)
			}
			tag := ""
			if cursor < len(columnType) && columnType[cursor] == '[' {
				tag, cursor, err = parseTypeArgument(columnType, cursor, marker)
				if err != nil {
					return modifiers, err
				}
			}
			if !typeBoundary(columnType, cursor) {
				return modifiers, fmt.Errorf("bad type %q: malformed clas[level][tag] modifier", columnType)
			}
			modifiers.classificationLevel, modifiers.classificationTag = argument, tag
			modifiers.hasClassification = true
		case "link":
			if modifiers.hasLink {
				return modifiers, fmt.Errorf("bad type %q: exactly one link[template] modifier is allowed", columnType)
			}
			if !typeBoundary(columnType, cursor) {
				return modifiers, fmt.Errorf("bad type %q: malformed link[template] modifier", columnType)
			}
			if err := validateLinkTemplate(argument); err != nil {
				return modifiers, fmt.Errorf("bad type %q: %w", columnType, err)
			}
			modifiers.linkTemplate, modifiers.hasLink = argument, true
		case "set":
			if modifiers.hasSetChoices || modifiers.hasToken("set") {
				return modifiers, fmt.Errorf("bad type %q: exactly one set or set[choices] declaration is allowed", columnType)
			}
			if !typeBoundary(columnType, cursor) {
				return modifiers, fmt.Errorf("bad type %q: malformed set[choices] modifier", columnType)
			}
			modifiers.setChoices, modifiers.hasSetChoices = argument, true
			modifiers.tokens["set"] = struct{}{}
		}
	}
	return modifiers, nil
}

func canonicalColumnTypeToken(token string) string {
	if token == "smiles" {
		return "SMILES"
	}
	return token
}

func validateLinkTemplate(template string) error {
	if strings.Count(template, "%s") != 1 {
		return fmt.Errorf("link template must contain exactly one %%s placeholder")
	}
	if strings.ContainsRune(template, '\\') {
		return fmt.Errorf("link template must not contain backslashes")
	}
	for _, char := range template {
		if unicode.IsControl(char) || unicode.IsSpace(char) {
			return fmt.Errorf("link template must not contain whitespace or control characters")
		}
	}

	placeholder := strings.Index(template, "%s")
	candidate := strings.Replace(template, "%s", "safe-value", 1)
	parsed, err := url.Parse(candidate)
	if err != nil {
		return fmt.Errorf("link template is not a valid URL: %w", err)
	}

	if strings.HasPrefix(template, "https://") {
		authorityEnd := len(template)
		if separator := strings.IndexAny(template[len("https://"):], "/?#"); separator >= 0 {
			authorityEnd = len("https://") + separator
		}
		if placeholder < authorityEnd {
			return fmt.Errorf("link placeholder must not control the URL authority")
		}
		if parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || parsed.Opaque != "" {
			return fmt.Errorf("link template must use an authoritative HTTPS URL")
		}
		return validateLinkPathPlaceholder(template, placeholder, authorityEnd)
	}

	if strings.HasPrefix(template, "/") && !strings.HasPrefix(template, "//") && placeholder > 1 {
		if parsed.IsAbs() || parsed.Host != "" || !strings.HasPrefix(parsed.Path, "/") {
			return fmt.Errorf("relative link template must remain on the current origin")
		}
		return validateLinkPathPlaceholder(template, placeholder, 0)
	}

	return fmt.Errorf("link template must use HTTPS with a fixed host or a fixed root-relative path")
}

func validateLinkPathPlaceholder(template string, placeholder, pathStart int) error {
	pathEnd := len(template)
	if suffix := strings.IndexAny(template[pathStart:], "?#"); suffix >= 0 {
		pathEnd = pathStart + suffix
	}
	placeholderEnd := placeholder + len("%s")
	if placeholder <= pathStart || placeholderEnd > pathEnd || template[placeholder-1] != '/' ||
		(placeholderEnd != pathEnd && template[placeholderEnd] != '/') {
		return fmt.Errorf("link placeholder must occupy one complete URL path segment")
	}
	return nil
}

func isTypeSpace(value byte) bool {
	return strings.ContainsRune(" \t\r\n", rune(value))
}

func typeBoundary(columnType string, cursor int) bool {
	return cursor == len(columnType) || (cursor < len(columnType) && isTypeSpace(columnType[cursor]))
}

func parseTypeArgument(columnType string, opening int, marker string) (string, int, error) {
	if opening >= len(columnType) || columnType[opening] != '[' {
		return "", opening, fmt.Errorf("bad type %q: malformed %s[...] modifier", columnType, marker)
	}
	endRel := strings.IndexByte(columnType[opening+1:], ']')
	if endRel < 0 {
		return "", opening, fmt.Errorf("bad type %q: malformed %s[...] modifier", columnType, marker)
	}
	end := opening + 1 + endRel
	argument := strings.TrimSpace(columnType[opening+1 : end])
	if argument == "" || strings.ContainsAny(argument, "[]") {
		return "", opening, fmt.Errorf("bad type %q: malformed %s[...] modifier", columnType, marker)
	}
	return argument, end + 1, nil
}

// HasColumnTypeToken exposes the same exact-token semantics to consumers of
// persisted import metadata. Modifier arguments never count as type tokens.
func HasColumnTypeToken(columnType, token string) (bool, error) {
	parsed, err := parseColumnType(columnType)
	if err != nil {
		return false, err
	}
	return parsed.hasToken(token), nil
}

// ParseExternalSheet recognizes exactly one external[nonempty-sheet] modifier.
// Marker words inside modifier arguments remain ordinary sheet/column text.
func ParseExternalSheet(columnType string) (string, bool, error) {
	modifiers, err := parseColumnType(columnType)
	return modifiers.external, modifiers.hasExternal, err
}

func parseDefaultColumn(columnType string) (string, bool, error) {
	modifiers, err := parseColumnType(columnType)
	return modifiers.defaultColumn, modifiers.hasDefaultColumn, err
}

func validateColumnTypeSyntax(columnType string) error {
	_, err := parseColumnType(columnType)
	return err
}

type VirtualSheet struct {
	ArrangeOfExternals []string // shows how to join data from different sheets
	RealSheetNames     []string
	ColumnNames        []string
	ColumnTypes        []string // unprocessed types
	ColumnCassTypes    []string // types to use in Cassandra
	KeyColumn          string
	Rows               map[string][]any
	is_postprocessed   bool
}

func NewVirtualSheet() *VirtualSheet {
	return &VirtualSheet{
		[]string{},
		[]string{},
		[]string{},
		[]string{},
		[]string{},
		"",
		make(map[string][]any),
		false,
	}
}

func (v_sheet *VirtualSheet) ReadFile(file *excelize.File) error {
	rows, err := excel.ReadXLSXToMapMerged(file, v_sheet.RealSheetNames, v_sheet.ColumnNames, v_sheet.KeyColumn)
	v_sheet.Rows = map[string][]any(rows)
	return err
}

func split_set(r rune) bool {
	return slices.Contains(settings.CassandraCollectionSeparators, r)
}

func (v_sheet *VirtualSheet) Postprocess() error {
	if v_sheet.is_postprocessed {
		return nil
	}
	error_messages := []string{}

	if len(v_sheet.ColumnNames) != len(v_sheet.ColumnTypes) {
		return fmt.Errorf("column names/types length mismatch")
	}
	type defaultColumns struct {
		defaultIndex int
		custom       []int
	}
	metaDefaults := make(map[string]*defaultColumns)
	externalNames := make([]string, len(v_sheet.ColumnTypes))
	parsedTypes := make([]columnModifiers, len(v_sheet.ColumnTypes))

	for i, _type := range v_sheet.ColumnTypes {
		if err := cassandra.ValidateIdentifier(v_sheet.ColumnNames[i]); err != nil {
			return err
		}
		parsedType, err := parseColumnType(_type)
		if err != nil {
			return err
		}
		parsedTypes[i] = parsedType
		externalNames[i] = parsedType.external
		default_col, hasDefault := parsedType.defaultColumn, parsedType.hasDefaultColumn
		if !hasDefault {
			continue
		}
		default_ind := excel.FindColumnIndex(v_sheet.ColumnNames, default_col)
		if default_ind == -1 {
			error_messages = append(error_messages, fmt.Sprintf(
				"bad type '%s', cannot find default column '%s'",
				_type, default_col,
			))
			continue
		}

		if _, exist := metaDefaults[default_col]; !exist {
			metaDefaults[default_col] = &defaultColumns{defaultIndex: default_ind}
		}
		metaDefaults[default_col].custom = append(metaDefaults[default_col].custom, i)
	}

	for key, row := range v_sheet.Rows {
		if len(row) != len(v_sheet.ColumnTypes) {
			error_messages = append(error_messages, fmt.Sprintf("row with primary key %q has %d values, want %d", key, len(row), len(v_sheet.ColumnTypes)))
			continue
		}
		// default cols
		for _, m := range metaDefaults {
			for _, custom_col := range m.custom {
				if row[custom_col] != "" {
					continue
				}
				row[custom_col] = row[m.defaultIndex]
			}
		}

		// type checks
		for j, item := range row {
			if externalNames[j] != "" && item == "" {
				error_messages = append(error_messages, fmt.Sprintf(
					"missing external key in row with primary key '%s' for column '%s'",
					key, v_sheet.ColumnNames[j],
				))
				continue
			}

			if parsedTypes[j].hasToken("set") {
				text, ok := item.(string)
				if !ok {
					error_messages = append(error_messages, fmt.Sprintf("non-text value in row %q column %q", key, v_sheet.ColumnNames[j]))
					continue
				}
				set_values := make(map[string]struct{})
				for _, val := range strings.FieldsFunc(text, split_set) {
					set_values[val] = struct{}{}
				}
				v_sheet.Rows[key][j] = set_values
			} else { // default
				if item == "" {
					v_sheet.Rows[key][j] = " "
				}
			}
		}
	}

	if len(error_messages) > 0 {
		return fmt.Errorf("errors in sheet with primary key '%s':\n%s",
			v_sheet.KeyColumn,
			strings.Join(error_messages, "\n"),
		)
	}

	v_sheet.ColumnCassTypes = make([]string, len(v_sheet.ColumnTypes))
	for i := range v_sheet.ColumnTypes {
		col_name := v_sheet.ColumnNames[i]
		if parsedTypes[i].hasToken("set") {
			v_sheet.ColumnCassTypes[i] = col_name + " SET<TEXT>"
		} else { // default
			v_sheet.ColumnCassTypes[i] = col_name + " TEXT"
		}
	}

	v_sheet.ArrangeOfExternals = externalNames

	v_sheet.is_postprocessed = true
	return nil
}
