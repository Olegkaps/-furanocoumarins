// Package searchquery defines the public search grammar shared by validation
// and persistence: OR expressions contain AND expressions, whose operands are
// comparisons or parenthesized expressions. Keywords are uppercase. Values are
// single-quoted strings; doubled apostrophes escape an apostrophe.
package searchquery

import (
	"fmt"
	"regexp"
	"strings"

	"admin/internal/pkg/identifier"
)

const (
	MaxBytes       = 16 * 1024
	MaxDepth       = 32
	MaxComparisons = 128
)

// Expression is either a comparison (Column, Operator, Value) or a boolean
// expression (Left, Operator, Right). Parse is its production constructor.
type Expression struct {
	Column, Operator, Value string
	Left, Right             *Expression
}

var comparison = regexp.MustCompile(`^([A-Za-z][A-Za-z0-9_]*)\s*(=|!=|<=|>=|<|>|LIKE|CONTAINS)\s*'((?:''|[^'])*)'`)

type parser struct {
	rest        string
	comparisons int
}

func Parse(raw string) (*Expression, error) {
	if len(raw) > MaxBytes {
		return nil, fmt.Errorf("search exceeds %d bytes", MaxBytes)
	}
	if strings.IndexByte(raw, 0) >= 0 {
		return nil, fmt.Errorf("search contains a NUL byte")
	}
	p := parser{rest: strings.TrimSpace(raw)}
	expr, err := p.or(0)
	if err != nil {
		return nil, err
	}
	if p.rest != "" {
		return nil, fmt.Errorf("unexpected search input")
	}
	return expr, nil
}

func (p *parser) take(token string) bool {
	if !strings.HasPrefix(p.rest, token) {
		return false
	}
	if token == "AND" || token == "OR" {
		if len(p.rest) > len(token) {
			c := p.rest[len(token)]
			if c != '(' && c != ' ' && c != '\t' && c != '\r' && c != '\n' {
				return false
			}
		}
	}
	p.rest = strings.TrimSpace(p.rest[len(token):])
	return true
}

func (p *parser) or(depth int) (*Expression, error) {
	left, err := p.and(depth)
	for err == nil && p.take("OR") {
		var right *Expression
		right, err = p.and(depth)
		left = &Expression{Operator: "OR", Left: left, Right: right}
	}
	return left, err
}

func (p *parser) and(depth int) (*Expression, error) {
	left, err := p.operand(depth)
	for err == nil && p.take("AND") {
		var right *Expression
		right, err = p.operand(depth)
		left = &Expression{Operator: "AND", Left: left, Right: right}
	}
	return left, err
}

func (p *parser) operand(depth int) (*Expression, error) {
	if p.take("(") {
		if depth >= MaxDepth {
			return nil, fmt.Errorf("search exceeds %d nested groups", MaxDepth)
		}
		expr, err := p.or(depth + 1)
		if err != nil {
			return nil, err
		}
		if !p.take(")") {
			return nil, fmt.Errorf("search group requires closing parenthesis")
		}
		return expr, nil
	}
	m := comparison.FindStringSubmatch(p.rest)
	if m == nil {
		return nil, fmt.Errorf("expected column, comparison operator, and single-quoted value")
	}
	if err := identifier.ValidateIdentifier(m[1]); err != nil {
		return nil, err
	}
	p.comparisons++
	if p.comparisons > MaxComparisons {
		return nil, fmt.Errorf("search exceeds %d comparisons", MaxComparisons)
	}
	p.rest = strings.TrimSpace(p.rest[len(m[0]):])
	return &Expression{Column: m[1], Operator: m[2], Value: strings.ReplaceAll(m[3], "''", "'")}, nil
}

// ValidateColumns checks every comparison, including all branches of OR.
func (e *Expression) ValidateColumns(allowed map[string]bool) error {
	if e.Left == nil {
		if !allowed[e.Column] {
			return fmt.Errorf("unknown search column %q", e.Column)
		}
		return nil
	}
	if err := e.Left.ValidateColumns(allowed); err != nil {
		return err
	}
	return e.Right.ValidateColumns(allowed)
}
