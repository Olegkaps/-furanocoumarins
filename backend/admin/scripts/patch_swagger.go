//go:build ignore

// patch_swagger.go adds additionalProperties: false and response examples to docs/swagger.json
// so Swagger UI shows correct field names (error, token, val) instead of additionalProp1/2/3.
// Run after swag init: go run ./scripts/patch_swagger.go
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

func main() {
	dir := filepath.Join("docs")
	if len(os.Args) > 1 {
		dir = os.Args[1]
	}
	path := filepath.Join(dir, "swagger.json")
	data, err := os.ReadFile(path)
	if err != nil {
		panic(err)
	}
	var spec map[string]interface{}
	if err := json.Unmarshal(data, &spec); err != nil {
		panic(err)
	}
	defs, _ := spec["definitions"].(map[string]interface{})
	if defs == nil {
		return
	}
	for name, def := range defs {
		obj, _ := def.(map[string]interface{})
		if obj == nil {
			continue
		}
		obj["additionalProperties"] = false
		// Add top-level example for our response types so UI shows it
		switch name {
		case "http.ErrorResponse":
			obj["example"] = map[string]interface{}{"error": "error message"}
		case "http.TokenResponse":
			obj["example"] = map[string]interface{}{"token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."}
		case "http.ArticleValResponse":
			obj["example"] = map[string]interface{}{"val": "@article{key2024,\n  author = {Smith, J.},\n  title = {Title},\n  year = {2024}\n}"}
		}
	}
	// Fix search.SearchResponse "data": {} so UI doesn't show additionalProp for it
	if sr, ok := defs["search.SearchResponse"].(map[string]interface{}); ok {
		if props, _ := sr["properties"].(map[string]interface{}); props != nil {
			if dataSchema, _ := props["data"].(map[string]interface{}); dataSchema != nil && len(dataSchema) == 0 {
				props["data"] = map[string]interface{}{
					"type":                 "array",
					"description":          "Result rows (dynamic columns)",
					"items":                map[string]interface{}{"type": "object", "additionalProperties": false},
					"additionalProperties": false,
				}
			}
		}
	}
	out, err := json.MarshalIndent(spec, "", "    ")
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile(path, out, 0644); err != nil {
		panic(err)
	}
}
