# Metadata versions

Metadata versions describe how imported workbook sheets become stored source
entities and public search/result views. The `chemdb.metadata_versions` table
stores immutable JSON definitions; the metadata schema format and the backend
table version are separate concepts.

## Rules

- New drafts use schema format 2.
- Published definitions are immutable.
- Dataset imports snapshot the latest published version before asynchronous
  processing and persist that version on the table record.
- Admin publication rejects a stale `base_version`.
- Historical format-1 definitions remain valid for pinned datasets.
- The editor and raw JSON view modify the same document.
- Preview data is synthetic and must not be confused with active data.

## Semantics

- `classification` belongs to species.
- `SMILES` belongs to chemicals.
- `publication` and `publications` are supported source entities, not new public
  search categories.
- Search placement, result placement, references, SMILES, and classification are
  metadata semantics over text and text-set storage.
- Empty set choices are derived from imported values.

## Code Links

- [Metadata document model](../../../backend/admin/internal/pkg/metadata/document.go)
- [Metadata version persistence](../../../backend/admin/internal/infrastructure/persistence/cassandra/metadata_versions.go)
- [Metadata HTTP handler](../../../backend/admin/internal/presentation/http/create/metadata.go)
- [Admin metadata editor](../../../frontend/src/Admin/MetadataEditor.tsx)
- [Admin metadata preview](../../../frontend/src/Admin/MetadataPreview.tsx)
- [Metadata preview model](../../../frontend/src/Admin/metadataPreviewModel.d.ts)
- [Metadata tests](../../../backend/admin/internal/pkg/metadata/document_test.go)

## Related Notes

- [[Import pipeline]]
- [[Search UI]]
- [[Local dev]]
