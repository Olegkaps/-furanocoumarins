export type MetadataColumn = {
  name: string; label?: string; description?: string; data_type: "text" | "set";
  primary_key?: boolean; external_sheet?: string; default_column?: string;
  search?: boolean; show_in_results?: boolean; result_order?: number | null;
  domain?: "chemical" | "species" | "publication"; reference?: boolean; smiles?: boolean; hidden?: boolean;
  example?: string | null;
  classification?: { level: number; tag?: string }; link_template?: string;
  set_choices?: string[]; legacy_flags?: string[];
};
export type MetadataSheet = { name: string; source_sheets: string[]; columns: MetadataColumn[] };
export type MetadataDocument = { schema_version: number; importable: boolean; sheets: MetadataSheet[]; legacy_metadata?: string[][] };
export type PreviewColumn = MetadataColumn & { sheet: string };
export type MetadataPreviewModel = {
  columns: PreviewColumn[]; search: PreviewColumn[]; results: PreviewColumn[];
  chemicals: PreviewColumn[]; species: PreviewColumn[]; structures: PreviewColumn[];
  classification: PreviewColumn[]; sourceOnly: string[]; errors: string[]; warnings: string[];
};
export function buildMetadataPreview(document?: MetadataDocument): MetadataPreviewModel;
export function classificationRows(columns: PreviewColumn[]): { level: number; columns: PreviewColumn[]; lanes: { tag: string; columns: PreviewColumn[] }[] }[];
export function previewQuery(columns: PreviewColumn[], values: Record<string, string>): string;
export function previewValue(column: PreviewColumn): string;
export function columnDomain(sheetName: string, column: MetadataColumn): MetadataColumn["domain"];
export function copyCommonColumn(sheetName: string, column: MetadataColumn): MetadataColumn;
