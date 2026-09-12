# Import pipeline

The import pipeline accepts an XLSX workbook, resolves it against a published
metadata version, preserves source sheets, and creates the joined public search
representation. The pipeline validates before writing so bad workbooks fail
without partial scientific-data changes.

## Import Contract

1. The admin uploads a workbook from `/admin`.
2. The backend snapshots the latest published [[Metadata versions|metadata
   version]].
3. A single async import guard prevents overlapping table imports.
4. Workbook parsing resolves virtual sheets, keys, references, defaults, set
   values, and public search/result placement.
5. Registered source sheets are stored separately, including rows that are not
   referenced by `main`.
6. The joined table remains the public search representation.
7. The table is marked ready only after the source tables and their catalog are
   saved.
8. Activation is a separate admin action after a table exists.

## Source Entities

- `classification` stores species rows.
- `structures` stores chemicals.
- `publication` or `publications` stores workbook publication records.
- Global BibTeX remains independent from workbook publication sheets.
- Source catalogs preserve physical sheet names, natural keys, external
  reference keys, original column metadata, provenance, and stored table names.

## Code Links

- [Import application service](../../../backend/admin/internal/application/create/import_table.go)
- [Source sheet preservation](../../../backend/admin/internal/application/create/source_sheets.go)
- [Virtual sheets](../../../backend/admin/internal/application/create/virtual_sheet.go)
- [XLSX reader](../../../backend/admin/internal/application/create/excel/xlsx.go)
- [Create-table HTTP handler](../../../backend/admin/internal/presentation/http/create/create_table.go)
- [Import tracker](../../../backend/admin/internal/presentation/http/create/import_tracker.go)
- [Admin import UI](../../../frontend/src/Admin/AdminUI.tsx)
- [Source catalog persistence](../../../backend/admin/internal/infrastructure/persistence/cassandra/source_catalog.go)

## Related Notes

- [[Metadata versions]]
- [[Auth master]]
- [[Local dev]]
