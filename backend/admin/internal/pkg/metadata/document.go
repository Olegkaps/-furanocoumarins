// Package metadata defines the durable, versioned workbook import contract.
// Presentation settings are separate from physical types and join definitions.
package metadata

import (
	identifiers "admin/internal/pkg/identifier"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

const MaxDocumentBytes = 1 << 20

type Document struct {
	SchemaVersion  int        `json:"schema_version"`
	Importable     bool       `json:"importable"`
	Sheets         []Sheet    `json:"sheets"`
	LegacyMetadata [][]string `json:"legacy_metadata,omitempty"`
}
type Sheet struct {
	Name         string   `json:"name"`
	SourceSheets []string `json:"source_sheets"`
	Columns      []Column `json:"columns"`
}
type Classification struct {
	Level int    `json:"level"`
	Tag   string `json:"tag,omitempty"`
}
type Column struct {
	Name           string          `json:"name"`
	Label          string          `json:"label,omitempty"`
	Description    string          `json:"description,omitempty"`
	Example        *string         `json:"example,omitempty"`
	DataType       string          `json:"data_type"`
	PrimaryKey     bool            `json:"primary_key,omitempty"`
	ExternalSheet  string          `json:"external_sheet,omitempty"`
	DefaultColumn  string          `json:"default_column,omitempty"`
	Search         bool            `json:"search,omitempty"`
	ShowInResults  bool            `json:"show_in_results,omitempty"`
	ResultOrder    *int            `json:"result_order,omitempty"`
	Domain         string          `json:"domain,omitempty"`
	Reference      bool            `json:"reference,omitempty"`
	Smiles         bool            `json:"smiles,omitempty"`
	ListName       bool            `json:"list_name,omitempty"`
	Hidden         bool            `json:"hidden,omitempty"`
	Classification *Classification `json:"classification,omitempty"`
	LinkTemplate   string          `json:"link_template,omitempty"`
	SetChoices     []string        `json:"set_choices,omitempty"`
	LegacyFlags    []string        `json:"legacy_flags,omitempty"`
}

// Decode rejects misspellings rather than silently discarding editor fields.
func Decode(data []byte) (Document, error) {
	var d Document
	if len(data) > MaxDocumentBytes {
		return d, fmt.Errorf("metadata exceeds 1 MiB")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&d); err != nil {
		return d, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return d, fmt.Errorf("expected one JSON document")
	}
	return d, d.Validate()
}

// DecodeDraft applies the current authoring contract. Historical version-one
// documents remain readable and importable through Decode and Validate.
func DecodeDraft(data []byte) (Document, error) {
	d, err := Decode(data)
	if err != nil {
		return d, err
	}
	if d.SchemaVersion != 2 {
		return d, fmt.Errorf("new metadata drafts require schema_version 2")
	}
	return d, nil
}

var identifier = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*$`)

func safeIdentifier(s string) bool { return len(s) <= 63 && identifiers.ValidateIdentifier(s) == nil }
func safeArgument(s string) bool   { return s != "" && !strings.ContainsAny(s, "[]\r\n\t") }

// ResolveJoins compiles v2 shared primary-key names into the explicit edges used
// by the importer. It never changes the saved definition or infers from main's
// optional key, and leaves groups outside the observation graph unjoined.
func (d Document) ResolveJoins() (Document, error) {
	if d.SchemaVersion < 2 {
		return d, nil
	}
	d.Sheets = append([]Sheet(nil), d.Sheets...)
	groups := map[string]int{}
	keys := map[string][]string{}
	for i, s := range d.Sheets {
		d.Sheets[i].Columns = append([]Column(nil), s.Columns...)
		groups[s.Name] = i
		for _, c := range s.Columns {
			if c.PrimaryKey && s.Name != "main" {
				keys[c.Name] = append(keys[c.Name], s.Name)
			}
		}
	}
	seen := map[string]bool{}
	var visit func(string) error
	visit = func(name string) error {
		if seen[name] {
			return nil
		}
		seen[name] = true
		i, exists := groups[name]
		if !exists {
			return nil
		} // Validate reports unknown explicit targets.
		for j := range d.Sheets[i].Columns {
			c := &d.Sheets[i].Columns[j]
			if c.ExternalSheet == "" && !c.PrimaryKey {
				var targets []string
				for _, target := range keys[c.Name] {
					if target != name {
						targets = append(targets, target)
					}
				}
				if len(targets) > 1 {
					return fmt.Errorf("ambiguous common column %s.%s matches primary keys in %s; set external_sheet to choose the target group", name, c.Name, strings.Join(targets, ", "))
				}
				if len(targets) == 1 {
					c.ExternalSheet = targets[0]
				}
			}
			if c.ExternalSheet != "" {
				if err := visit(c.ExternalSheet); err != nil {
					return err
				}
			}
		}
		return nil
	}
	err := visit("main")
	return d, err
}

func (d Document) Validate() error {
	if (d.SchemaVersion != 1 && d.SchemaVersion != 2) || !d.Importable || len(d.LegacyMetadata) > 0 {
		return fmt.Errorf("publish requires schema_version 1 or 2 and importable true without legacy_metadata")
	}
	var err error
	d, err = d.ResolveJoins()
	if err != nil {
		return err
	}
	if len(d.Sheets) == 0 || len(d.Sheets) > 64 {
		return fmt.Errorf("provide 1 to 64 sheets")
	}
	sheets := map[string]Sheet{}
	total := 0
	for _, s := range d.Sheets {
		if !safeIdentifier(s.Name) || strings.ToLower(s.Name) != s.Name {
			return fmt.Errorf("invalid sheet name %q", s.Name)
		}
		if _, ok := sheets[strings.ToLower(s.Name)]; ok {
			return fmt.Errorf("duplicate sheet %q", s.Name)
		}
		sheets[strings.ToLower(s.Name)] = s
		if len(s.SourceSheets) == 0 || len(s.SourceSheets) > 64 {
			return fmt.Errorf("sheet %s needs physical source_sheets", s.Name)
		}
		physical := map[string]bool{}
		for _, name := range s.SourceSheets {
			if strings.TrimSpace(name) == "" || len([]rune(name)) > 31 || strings.ContainsAny(name, ":\\/?*[]\r\n") || physical[strings.ToLower(name)] {
				return fmt.Errorf("invalid or duplicate source sheet %q", name)
			}
			physical[strings.ToLower(name)] = true
		}
		if len(s.Columns) == 0 {
			return fmt.Errorf("sheet %s has no columns", s.Name)
		}
		total += len(s.Columns)
		if total > 2048 {
			return fmt.Errorf("at most 2048 columns are supported")
		}
		cols := map[string]bool{}
		keys := 0
		for _, c := range s.Columns {
			if !safeIdentifier(c.Name) || strings.EqualFold(c.Name, "uuid") || cols[strings.ToLower(c.Name)] {
				return fmt.Errorf("invalid, reserved, or duplicate column %s.%s", s.Name, c.Name)
			}
			cols[strings.ToLower(c.Name)] = true
			if c.DataType != "text" && c.DataType != "set" {
				return fmt.Errorf("column %s: data_type must be text or set", c.Name)
			}
			if c.PrimaryKey {
				keys++
				if c.DataType != "text" {
					return fmt.Errorf("primary key %s must be text", c.Name)
				}
			}
			if c.ExternalSheet != "" && (!safeIdentifier(c.ExternalSheet) || c.DataType != "text") {
				return fmt.Errorf("external column %s must be text and name a sheet", c.Name)
			}
			if c.Domain != "" && c.Domain != "chemical" && c.Domain != "species" && c.Domain != "publication" {
				return fmt.Errorf("invalid domain for %s", c.Name)
			}
			inferred := inferredDomain(s.Name, c.ExternalSheet)
			if c.Domain != "" && inferred != "" && c.Domain != inferred {
				return fmt.Errorf("column %s.%s belongs to inferred %s domain", s.Name, c.Name, inferred)
			}
			if d.SchemaVersion >= 2 {
				domain := c.Domain
				if inferred != "" {
					domain = inferred
				}
				if c.Classification != nil && domain != "species" {
					return fmt.Errorf("classification is only available for species column %s.%s", s.Name, c.Name)
				}
				if c.Smiles && domain != "chemical" {
					return fmt.Errorf("SMILES is only available for chemical column %s.%s", s.Name, c.Name)
				}
				if c.ListName && domain != "chemical" {
					return fmt.Errorf("list_name is only available for chemical column %s.%s", s.Name, c.Name)
				}
				if c.ExternalSheet == "main" {
					return fmt.Errorf("main is the root sheets group and cannot be a join target")
				}
			}
			if c.ResultOrder != nil && (!c.ShowInResults || *c.ResultOrder < 0 || *c.ResultOrder > 9999) {
				return fmt.Errorf("result_order needs show_in_results and must be 0..9999")
			}
			if c.Classification != nil && (c.Classification.Level < 0 || c.Classification.Level > 9999 || (c.Classification.Tag != "" && !safeArgument(c.Classification.Tag))) {
				return fmt.Errorf("invalid classification for %s", c.Name)
			}
			if c.DataType != "set" && len(c.SetChoices) > 0 {
				return fmt.Errorf("set_choices require set data_type")
			}
			choices := map[string]bool{}
			for _, choice := range c.SetChoices {
				if !safeArgument(choice) || strings.ContainsAny(choice, " _") || strings.IndexFunc(choice, unicode.IsSpace) >= 0 || choice == "<>" || choices[choice] {
					return fmt.Errorf("invalid or duplicate set choice %q", choice)
				}
				choices[choice] = true
			}
			for _, flag := range c.LegacyFlags {
				if !identifier.MatchString(flag) || reservedFlag(flag) {
					return fmt.Errorf("legacy flag %q cannot override structured settings", flag)
				}
			}
			if c.LinkTemplate != "" {
				if err := validateLink(c.LinkTemplate); err != nil {
					return fmt.Errorf("column %s: %w", c.Name, err)
				}
			}
		}
		if keys > 1 || (s.Name != "main" && keys != 1) {
			return fmt.Errorf("sheet %s requires exactly one primary key (main may be keyless)", s.Name)
		}
		for _, c := range s.Columns {
			if c.DefaultColumn != "" && (!cols[strings.ToLower(c.DefaultColumn)] || c.DefaultColumn == c.Name) {
				return fmt.Errorf("unknown or self-referencing default_column %s.%s", s.Name, c.DefaultColumn)
			}
		}
		defaults := map[string]string{}
		for _, c := range s.Columns {
			defaults[c.Name] = c.DefaultColumn
		}
		for _, c := range s.Columns {
			seen := map[string]bool{}
			for name := c.Name; name != ""; name = defaults[name] {
				if seen[name] {
					return fmt.Errorf("cyclic defaults at %s.%s", s.Name, name)
				}
				seen[name] = true
				if _, ok := defaults[name]; !ok {
					return fmt.Errorf("default column %s must match exact case", name)
				}
			}
		}
	}
	if _, ok := sheets["main"]; !ok {
		return fmt.Errorf("main sheet is required")
	}
	if _, ok := sheets["classification"]; !ok {
		return fmt.Errorf("classification sheet is required")
	}
	for _, s := range d.Sheets {
		for _, c := range s.Columns {
			if c.ExternalSheet != "" {
				target, ok := sheets[c.ExternalSheet]
				if !ok {
					return fmt.Errorf("unknown external_sheet %s", c.ExternalSheet)
				}
				found := false
				for _, key := range target.Columns {
					if key.PrimaryKey && key.Name == c.Name {
						found = true
					}
				}
				if !found {
					return fmt.Errorf("external column %s must match the primary column of %s", c.Name, c.ExternalSheet)
				}
			}
		}
	}
	state := map[string]int{}
	var visit func(string) error
	visit = func(name string) error {
		if state[name] == 1 {
			return fmt.Errorf("cyclic external joins at %s", name)
		}
		if state[name] == 2 {
			return nil
		}
		state[name] = 1
		for _, c := range sheets[name].Columns {
			if c.ExternalSheet != "" {
				if err := visit(c.ExternalSheet); err != nil {
					return err
				}
			}
		}
		state[name] = 2
		return nil
	}
	for name := range sheets {
		if err := visit(name); err != nil {
			return err
		}
	}
	// Public metadata collapses joined columns by name. Reject divergent
	// settings before publishing a version which no workbook could import.
	public := map[string]bool{}
	var collect func(string)
	collect = func(name string) {
		if public[name] {
			return
		}
		public[name] = true
		for _, c := range sheets[name].Columns {
			if c.ExternalSheet != "" {
				collect(c.ExternalSheet)
			}
		}
	}
	collect("main")
	columns := map[string]Column{}
	for _, s := range d.Sheets {
		if !public[s.Name] {
			continue
		}
		for _, original := range s.Columns {
			c := original
			c.PrimaryKey = false
			c.ExternalSheet = ""
			c.Label = ""
			c.Example = nil
			if domain := inferredDomain(s.Name, original.ExternalSheet); domain != "" {
				c.Domain = domain
			}
			// keycolumn is inferred by the old importer from primary/join edges.
			c.LegacyFlags = append([]string(nil), c.LegacyFlags...)
			filtered := c.LegacyFlags[:0]
			for _, flag := range c.LegacyFlags {
				if flag != "keycolumn" {
					filtered = append(filtered, flag)
				}
			}
			c.LegacyFlags = filtered
			if len(c.LegacyFlags) == 0 {
				c.LegacyFlags = nil
			}
			sort.Strings(c.LegacyFlags)
			if old, ok := columns[strings.ToLower(c.Name)]; ok && !reflect.DeepEqual(old, c) {
				return fmt.Errorf("joined column %s has conflicting settings between sheets", c.Name)
			}
			columns[strings.ToLower(c.Name)] = c
		}
	}
	return nil
}

func inferredDomain(sheet, external string) string {
	if strings.HasPrefix(sheet, "structures") || external == "structures" {
		return "chemical"
	}
	if strings.HasPrefix(sheet, "classification") || external == "classification" {
		return "species"
	}
	if sheet == "publication" || sheet == "publications" || external == "publication" || external == "publications" {
		return "publication"
	}
	return ""
}

func reservedFlag(s string) bool {
	switch s {
	case "primary", "search", "invisible", "set", "SMILES", "smiles", "list_name", "chemical", "specie", "publication", "external", "default", "clas", "link":
		return true
	}
	return strings.HasPrefix(s, "table_")
}
func validateLink(s string) error {
	if strings.Count(s, "%s") != 1 || strings.ContainsAny(s, "[]\\") {
		return fmt.Errorf("link_template requires one %%s path placeholder")
	}
	for _, r := range s {
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			return fmt.Errorf("link_template contains whitespace or controls")
		}
	}
	u, e := url.Parse(strings.Replace(s, "%s", "value", 1))
	if e != nil {
		return fmt.Errorf("invalid link_template")
	}
	start := 0
	if strings.HasPrefix(s, "https://") {
		start = len("https://") + len(u.Host)
		if u.Hostname() == "" || u.User != nil {
			return fmt.Errorf("link_template requires fixed HTTPS host")
		}
	} else if !strings.HasPrefix(s, "/") || strings.HasPrefix(s, "//") || u.IsAbs() {
		return fmt.Errorf("link_template requires HTTPS or a root-relative path")
	}
	end := len(s)
	if i := strings.IndexAny(s[start:], "?#"); i >= 0 {
		end = start + i
	}
	position := strings.Index(s, "%s")
	if position <= start || position+2 > end {
		return fmt.Errorf("link placeholder must be in the path")
	}
	return nil
}

// Rows bridges the typed contract to the existing tested join implementation.
// No synthetic workbook or metadata worksheet is created.
func (d Document) Rows() (map[string][]string, error) {
	if err := d.Validate(); err != nil {
		return nil, err
	}
	d, err := d.ResolveJoins()
	if err != nil {
		return nil, err
	}
	rows := map[string][]string{}
	index := 0
	add := func(row []string) { index++; rows[strconv.Itoa(index)] = row }
	for _, s := range d.Sheets {
		for _, name := range s.SourceSheets {
			add([]string{"__LIST__", name, s.Name, "", ""})
		}
		for _, c := range s.Columns {
			if d.SchemaVersion >= 2 && inferredDomain(s.Name, c.ExternalSheet) == "publication" {
				c.Domain = "publication"
			}
			add([]string{s.Name, c.Name, c.LegacyType(), c.Description, c.Label})
		}
	}
	return rows, nil
}
func (c Column) LegacyType() string {
	flags := []string{}
	add := func(ok bool, flag string) {
		if ok {
			flags = append(flags, flag)
		}
	}
	add(c.PrimaryKey, "primary")
	add(c.Search, "search")
	add(c.Hidden, "invisible")
	add(c.Reference, "ref[]")
	add(c.Smiles, "SMILES")
	add(c.ListName, "list_name")
	if c.DataType == "set" {
		if len(c.SetChoices) > 0 {
			flags = append(flags, "set["+strings.Join(c.SetChoices, " ")+"]")
		} else {
			flags = append(flags, "set")
		}
	}
	if c.ShowInResults {
		flag := "table_"
		if c.ResultOrder != nil {
			flag += strconv.Itoa(*c.ResultOrder)
		}
		flags = append(flags, flag)
	}
	add(c.Domain == "chemical", "chemical")
	add(c.Domain == "species", "specie")
	add(c.Domain == "publication", "publication")
	if c.ExternalSheet != "" {
		flags = append(flags, "external["+c.ExternalSheet+"]")
	}
	if c.DefaultColumn != "" {
		flags = append(flags, "default["+c.DefaultColumn+"]")
	}
	if c.Classification != nil {
		flag := "clas[" + strconv.Itoa(c.Classification.Level) + "]"
		if c.Classification.Tag != "" {
			flag += "[" + c.Classification.Tag + "]"
		}
		flags = append(flags, flag)
	}
	if c.LinkTemplate != "" {
		flags = append(flags, "link["+c.LinkTemplate+"]")
	}
	return strings.Join(append(flags, c.LegacyFlags...), " ")
}

var legacyToken = regexp.MustCompile(`(?:external|default|set|link)\[[^\[\]]+\]|clas\[[^\[\]]+\](?:\[[^\[\]]+\])?|ref\[\]|[^\s]+`)

func ColumnFromLegacy(row []string) (Column, error) {
	if len(row) != 5 {
		return Column{}, fmt.Errorf("legacy metadata row requires five fields")
	}
	c := Column{Name: row[1], DataType: "text", Description: row[3], Label: row[4]}
	for _, token := range legacyToken.FindAllString(row[2], -1) {
		switch token {
		case "primary":
			c.PrimaryKey = true
		case "search":
			c.Search = true
		case "invisible":
			c.Hidden = true
		case "SMILES", "smiles":
			c.Smiles = true
		case "list_name":
			c.ListName = true
		case "chemical":
			c.Domain = "chemical"
		case "specie":
			c.Domain = "species"
		case "publication":
			c.Domain = "publication"
		case "ref[]":
			c.Reference = true
		case "set", "set[<>]":
			c.DataType = "set"
		case "table_chemical":
			c.Domain = "chemical"
			c.ShowInResults = true
		case "table_specie":
			c.Domain = "species"
			c.ShowInResults = true
		default:
			arg := func(prefix string) string { return strings.TrimSuffix(strings.TrimPrefix(token, prefix+"["), "]") }
			switch {
			case strings.HasPrefix(token, "external["):
				c.ExternalSheet = arg("external")
			case strings.HasPrefix(token, "default["):
				c.DefaultColumn = arg("default")
			case strings.HasPrefix(token, "link["):
				c.LinkTemplate = arg("link")
			case strings.HasPrefix(token, "set["):
				c.DataType = "set"
				c.SetChoices = strings.Fields(arg("set"))
			case strings.HasPrefix(token, "clas["):
				parts := strings.Split(arg("clas"), "][")
				level, e := strconv.Atoi(parts[0])
				if e != nil {
					return c, e
				}
				c.Classification = &Classification{Level: level}
				if len(parts) > 1 {
					c.Classification.Tag = parts[1]
				}
			case strings.HasPrefix(token, "table_"):
				c.ShowInResults = true
				if token != "table_" {
					order, e := strconv.Atoi(strings.TrimPrefix(token, "table_"))
					if e != nil {
						return c, e
					}
					c.ResultOrder = &order
				}
			default:
				c.LegacyFlags = append(c.LegacyFlags, token)
			}
		}
	}
	return c, nil
}
