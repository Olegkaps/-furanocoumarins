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
	for _, def := range defs {
		obj, _ := def.(map[string]interface{})
		if obj == nil {
			continue
		}
		obj["additionalProperties"] = false
	}

	setExample := func(name string, example map[string]interface{}) {
		obj, _ := defs[name].(map[string]interface{})
		if obj == nil {
			return
		}
		obj["example"] = example
	}

	setExample("response.ErrorResponse", map[string]interface{}{"error": "error message"})
	setExample("response.TokenResponse", map[string]interface{}{"token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."})
	setExample("response.ArticleValResponse", map[string]interface{}{
		"val": "@article{key2024,\n  author = {Smith, J.},\n  title = {Title},\n  year = {2024}\n}",
	})
	setExample("search.AutocompleteResponse", map[string]interface{}{
		"values": []string{"Angelica archangelica", "Angelica dahurica"},
	})
	setExample("search.ColumnMeta", map[string]interface{}{
		"column":      "species",
		"name":        "Species",
		"type":        "text search",
		"description": "Plant species name",
	})
	setExample("cassandra.Table", map[string]interface{}{
		"created_at":   "2026-01-15T12:00:00Z",
		"name":         "furanocoumarins_v2",
		"version":      "v2.0",
		"is_ok":        true,
		"is_active":    true,
		"tableData":    "chemdb.data_2026_01_15T12_00_00_000",
		"tableMeta":    "chemdb.meta_2026_01_15T12_00_00_000",
		"tableSpecies": "chemdb.species_2026_01_15T12_00_00_000",
	})

	metaExample := map[string]interface{}{
		"metadata": []map[string]interface{}{{
			"column":      "species",
			"name":        "Species",
			"type":        "text search",
			"description": "Plant species name",
		}},
		"timestamp": "2026-01-15T12:00:00Z",
	}
	setExample("admin_internal_domain_search.MetadataResponse", metaExample)
	setExample("admin_internal_presentation_http_search.MetadataResponse", metaExample)
	setExample("admin_internal_domain_search.SearchResponse", map[string]interface{}{
		"metadata":  metaExample["metadata"],
		"timestamp": "2026-01-15T12:00:00Z",
		"data": []map[string]interface{}{{
			"species": "Angelica archangelica",
			"smiles":  "O=C1Oc2ccccc2C=C1",
		}},
	})
	setExample("admin_internal_presentation_http_search.SearchResponse", map[string]interface{}{
		"metadata":  metaExample["metadata"],
		"timestamp": "2026-01-15T12:00:00Z",
		"data": []map[string]interface{}{{
			"species": "Angelica archangelica",
			"smiles":  "O=C1Oc2ccccc2C=C1",
		}},
	})

	// Fix search.SearchResponse "data": {} so UI doesn't show additionalProp for it
	for _, name := range []string{
		"admin_internal_presentation_http_search.SearchResponse",
		"admin_internal_domain_search.SearchResponse",
		"search.SearchResponse",
	} {
		if sr, ok := defs[name].(map[string]interface{}); ok {
			if props, _ := sr["properties"].(map[string]interface{}); props != nil {
				if dataSchema, _ := props["data"].(map[string]interface{}); dataSchema != nil {
					props["data"] = map[string]interface{}{
						"type":        "array",
						"description": "Result rows (dynamic columns)",
						"items": map[string]interface{}{
							"type":                 "object",
							"additionalProperties": true,
							"example": map[string]interface{}{
								"species": "Angelica archangelica",
								"smiles":  "O=C1Oc2ccccc2C=C1",
							},
						},
					}
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
