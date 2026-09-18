import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BookOpen, BranchesRight, Molecule } from "@gravity-ui/icons";
import { buildMetadataPreview, classificationRows, previewValue, type MetadataDocument, type MetadataPreviewModel, type PreviewColumn } from "./metadataPreviewModel";
import { safeMetadataLink } from "../shared/metadataType";
import { SearchForm, type SearchColumn } from "../SearchApp/SearchApp";
import DataMeta from "../SearchApp/DataMeta";
import { Container } from "../shared/ui";
import { InfoTip } from "../shared/ui/InfoTip";
import { ChemicalPageView } from "../SubstancePage/SubstancePage";
import { TaxonPageView } from "../TaxonPage/TaxonomyPage";
import { ReadOnlyPageContent } from "../features/editable-page/EditablePageContent";

const views = ["Search", "Results table", "Chemical page", "Species page", "Classification"] as const;
type EditColumn = (column: PreviewColumn) => void;
const EditColumnContext = createContext<EditColumn | undefined>(undefined);
function ColumnTarget({ column, children }: { column: PreviewColumn; children: ReactNode }) {
  const onEditColumn = useContext(EditColumnContext);
  return onEditColumn ? <button type="button" className="metadata-column-target" data-preview-sheet={column.sheet} data-preview-column={column.name}
    aria-label={`Edit ${column.sheet}.${column.name}`} onClick={() => onEditColumn(column)}>{children}</button> : <>{children}</>;
}

export default function MetadataPreview({ document, validating = false, onEditColumn, onOpenEditor, editorOpen = false }: { document?: MetadataDocument; validating?: boolean; onEditColumn?: EditColumn; onOpenEditor?: () => void; editorOpen?: boolean }) {
  const [view, setView] = useState<typeof views[number]>("Search");
  const model = buildMetadataPreview(document);
  return <EditColumnContext.Provider value={onEditColumn}><aside className="metadata-preview" aria-labelledby="preview-title">
    <h2 id="preview-title">Draft preview</h2>
    {onOpenEditor && <button type="button" className="btn metadata-preview-expand" aria-expanded={editorOpen} aria-controls="metadata-side-editor" onClick={onOpenEditor}>Open editor</button>}
    <p>Column examples, not dataset records. These public-view previews never save, search, or open sample links.</p>
    {onEditColumn && <p>Click a field label or example to edit its column in the side panel.</p>}
    <div className="metadata-preview-tabs" role="group" aria-label="Preview view">
      {views.map(name => <button key={name} className="btn" type="button" aria-pressed={view === name} onClick={() => setView(name)}>{name}</button>)}
    </div>
    {validating && !document ? <div role="status"><h3>Checking draft preview…</h3><p>Validating JSON and join rules.</p></div> : model.errors.length > 0 ? <div role="status"><h3>Preview unavailable</h3><ul>{model.errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div> : <>
      {view === "Search" && <SearchPreview columns={model.search} />}
      {view === "Results table" && <ResultsPreview model={model} />}
      {view === "Chemical page" && <EntityPagePreview kind="chemical" columns={model.chemicalPage} smilesColumn={model.structures[0]} />}
      {view === "Species page" && <EntityPagePreview kind="species" columns={model.speciesPage} />}
      {view === "Classification" && <ClassificationPreview columns={model.classification} />}
      {model.warnings.length > 0 && <ul className="metadata-preview-warnings">{model.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      {model.sourceOnly.length > 0 && <p>Preserved source-only sheets (not joined into public views): {model.sourceOnly.join(", ")}.</p>}
    </>}
  </aside></EditColumnContext.Provider>;
}

export function SearchPreview({ columns }: { columns: PreviewColumn[] }) {
  const [submitted, setSubmitted] = useState(false);
  const [query, setQuery] = useState("");
  const searchColumns = columns.map(previewSearchColumn);
  return <section aria-label="Search preview">
    <div className="metadata-preview-scroll" role="region" aria-label="Public search form" tabIndex={0}>
      <SearchForm metadataColumns={searchColumns} fetchSuggestions={async request => draftSuggestions(columns, request.value, request.columns)} onSearch={value => { setQuery(value); setSubmitted(true); }}
        columnLabel={(column, label) => {
          const source = columns.find(candidate => candidate.name === column.column);
          return source ? <ColumnTarget column={source}>{label}</ColumnTarget> : label;
        }} />
    </div>
    <h3>Sample query</h3><output className="metadata-preview-query">{query || (submitted ? "Enter at least one parameter." : "Enter a value above to see the query.")}</output>
    <small>Suggestions use only the draft’s examples and set choices. Search displays this query without requesting data.</small>
  </section>;
}

function previewSearchColumn(column: PreviewColumn): SearchColumn {
  const classification = column.classification ? ` clas[${column.classification.level}][${previewClassificationTag(column)}]` : "";
  const domain = column.reference || column.domain === "publication" ? "publication" : column.domain === "species" ? "specie" : "chemical";
  return { column: column.name, name: column.name, show_name: column.label || column.name, type: `${domain} search${column.reference ? " ref[]" : ""}${column.data_type === "set" ? " set" : ""}${column.smiles ? " SMILES" : ""}${classification}` };
}

function previewClassificationTag(column: PreviewColumn) {
  const tag = column.classification?.tag;
  return !tag || tag === "default" ? "original" : tag;
}

function draftSuggestions(columns: PreviewColumn[], value: string, selected: SearchColumn[]) {
  const needle = value.toLowerCase();
  return selected.flatMap(column => {
    const source = columns.find(candidate => candidate.name === column.column);
    if (!source) return [];
    return (source.set_choices?.length ? source.set_choices : source.example ? [source.example] : []).filter(candidate => candidate.toLowerCase().includes(needle)).map(candidate => ({ column: column.column, show_name: column.show_name || column.column, value: candidate }));
  });
}

export function ResultsPreview({ model }: { model: MetadataPreviewModel }) {
  return <section aria-label="Results table preview">
    <p>Both states are shown below: the lists before selection, then the panels after selecting a chemical and a species. Counts illustrate one sample observation.</p>
    <ResultsState model={model} selected={false} /><ResultsState model={model} selected />
  </section>;
}

function ResultsState({ model, selected }: { model: MetadataPreviewModel; selected: boolean }) {
  return <section className="metadata-result-state" aria-label={selected ? "After selection" : "Before selection"}>
    <h3>{selected ? "After selection" : "Before selection"}</h3>
    <div className="panel panel-toolbar metadata-result-toolbar"><span>Count in lists: <b>{selected ? "articles" : "chemicals / species"}</b></span><span>Rows in selection: <b>1 (sample)</b></span></div>
    <div className="metadata-preview-scroll" role="region" aria-label={`${selected ? "Selected" : "Unselected"} results workspace`} tabIndex={0}>
      <div className="grouped-result-row metadata-result-workspace">
        <EntityPanel kind="chemical" columns={model.chemicals} selected={selected} />
        <div className="metadata-result-center">
          {selected ? <StructurePreview columns={model.structures} /> : <Container><p className="empty-state">Hover or select a chemical to show its structure</p></Container>}
          {selected ? <ObservationsPreview columns={model.results} /> : <Container><p className="empty-state">Select species or chemical</p></Container>}
        </div>
        <EntityPanel kind="species" columns={model.species} selected={selected} />
      </div>
    </div>
  </section>;
}

function EntityPanel({ kind, columns, selected }: { kind: "chemical" | "species"; columns: PreviewColumn[]; selected: boolean }) {
  const Icon = kind === "chemical" ? Molecule : BranchesRight;
  const title = kind === "chemical" ? "Chemical" : "Species";
  return <Container maxHeight="none" style={{ minWidth: 0 }}>
    <div className="side-panel__header"><span className={`badge badge-${kind}`}><Icon width={16} height={16} aria-hidden />{title} ({columns.length ? 1 : 0})</span></div>
    {!columns.length ? <p className="empty-state">No visible result fields for this entity.</p> : selected ? <table className="metadata-entity-table"><tbody>{columns.map(c => <tr key={c.name}>
      <td><InfoTip text={c.description || ""} /> <ColumnTarget column={c}>{c.label || c.name}</ColumnTarget></td><td><SampleCell column={c} /></td>
    </tr>)}</tbody></table> : <ol className="ranked-select-list"><li><div className="ranked-select-list__item">
      <span className="ranked-select-list__index">1.</span><span className="ranked-select-list__value"><ColumnTarget column={columns[0]}>{previewValue(columns[0])}</ColumnTarget></span>
      <span className="ranked-select-list__count">{kind === "chemical" ? "species" : "chemicals"}: 1</span>
    </div></li></ol>}
  </Container>;
}

export function EntityPagePreview({ kind, columns, smilesColumn }: { kind: "chemical" | "species"; columns: PreviewColumn[]; smilesColumn?: PreviewColumn }) {
  const title = kind === "chemical" ? "Chemical page" : "Species page";
  const details = { meta: columns.map(column => previewDataMeta(column, kind)), row: new Map(columns.map(column => [column.name, previewValue(column)])) };
  const configuredSmiles = smilesColumn ?? columns.find(column => column.smiles);
  const smiles = configuredSmiles ? previewValue(configuredSmiles) : "CCO";
  const detailLabel = (column: DataMeta) => {
    const source = columns.find(candidate => candidate.name === column.name);
    return source ? <ColumnTarget column={source}>{column.show_name}</ColumnTarget> : column.show_name;
  };
  const content = <ReadOnlyPageContent content={kind === "chemical" ? "## Example chemical description\n\nThis representative Markdown content shows how an imported chemical page will read next to its structure and selected details." : "## Example species description\n\nThis representative Markdown content shows the page description beside its taxonomy links and selected details."} error={null} />;
  return <section aria-label={`${title} preview`}>
    <h3>{title}</h3>
    <p>This uses the public {kind} page frame with example content only. It cannot load data, navigate, or edit a page.</p>
    {kind === "chemical" ? <ChemicalPageView smiles={smiles} details={details} renderDetailLabel={detailLabel}>
      {content}
    </ChemicalPageView> : <TaxonPageView taxon={previewTaxon(columns)} details={details} renderDetailLabel={detailLabel} renderTaxonLink={(_, content) => <span className="metadata-preview-taxon-link">{content}</span>}>
      {content}
    </TaxonPageView>}
  </section>;
}

function previewTaxon(columns: PreviewColumn[]) {
  const titleColumn = columns.find(column => column.classification?.level === 0) ?? columns[0];
  const title = titleColumn ? previewValue(titleColumn) : "Example species";
  return { rank: titleColumn?.classification?.level ?? 0, name: title, title, parent: { rank: 1, name: "Example genus" }, children: [{ rank: -1, name: "Example child taxon", source_column: "classification" }] };
}

function previewDataMeta(column: PreviewColumn, kind: "chemical" | "species") {
  // A draft preview must never expose a live destination. Keep the public
  // table's layout but render configured links as ordinary example text.
  const type = column.smiles ? "smiles" : column.reference ? "reference" : column.classification ? "clas" : "";
  return new DataMeta(type, column.name, column.label || column.name, column.description || "", column.link_template || "", kind === "species" ? "specie" : "chemical", {
    classificationLevel: column.classification?.level ?? null,
    classificationTag: previewClassificationTag(column),
  });
}

function ObservationsPreview({ columns }: { columns: PreviewColumn[] }) {
  return <Container maxHeight="none"><h3>Observations</h3>
    {columns.length ? <div className="table metadata-preview-scroll"><table><thead><tr>{columns.map(c => <th key={c.name} scope="col">{c.reference && <BookOpen width={18} height={18} aria-hidden />}<ColumnTarget column={c}>{c.label || c.name}</ColumnTarget> <InfoTip text={c.description || ""} /></th>)}</tr></thead>
      <tbody><tr>{columns.map(c => <td key={c.name}><SampleCell column={c} /></td>)}</tr></tbody></table></div> : <p>No general columns are selected for the observation table.</p>}
    <div className="metadata-reference-preview"><h3><BookOpen width={18} height={18} aria-hidden /> References</h3>
      {columns.some(c => c.reference) ? columns.filter(c => c.reference).map(c => <p key={c.name}><SampleCell column={c} /></p>) : <p>No visible reference column is configured.</p>}
      <small>Reference keys are illustrative; bibliography details require imported data.</small>
    </div>
  </Container>;
}

function SampleCell({ column }: { column: PreviewColumn }) {
  return <ColumnTarget column={column}><SampleValue column={column} /></ColumnTarget>;
}
function SampleValue({ column }: { column: PreviewColumn }) {
  const value = previewValue(column);
  if (column.example == null) return <span>{value}</span>;
  if (column.link_template) {
    const url = safeMetadataLink(column.link_template, value);
    return url ? <span className="link-button" title={url}>{value}</span> : <span>Invalid link template</span>;
  }
  if (column.classification) return <span>{value} <small>{column.classification.tag || "default"}</small></span>;
  if (column.smiles) return <code>{value}</code>;
  if (column.reference) return <span className="citation-ref-list">{value.split(/\s*,\s*/).map((key, index) => <span key={index} className="citation-ref-list__item"><span className="metadata-sample-link">{index > 0 ? ", " : ""}[{key}]</span></span>)}</span>;
  return <span>{value}</span>;
}

function StructurePreview({ columns }: { columns: PreviewColumn[] }) {
  return <Container maxHeight="none"><h3><Molecule width={18} height={18} aria-hidden /> Molecular structures</h3>
    {columns.length ? columns.map(c => <div key={c.name}><ColumnTarget column={c}><strong>{c.label || c.name}</strong></ColumnTarget><SmilesPreview key={c.example} column={c} /></div>) : <p className="empty-state">No SMILES column is configured.</p>}
  </Container>;
}

type SmilesRenderer = {
  Drawer: new (options: { width: number; height: number; isomeric: boolean }) => { draw: (tree: unknown, id: string, theme: string, weights: boolean) => void };
  parse: (value: string, success: (tree: unknown) => void, failure: () => void) => void;
};
function SmilesPreview({ column }: { column: PreviewColumn }) {
  const id = `metadata-molecule-${useId().replace(/:/g, "")}`;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("Preparing molecular drawing…");
  useEffect(() => {
    if (!column.example) return;
    const renderer = (window as Window & { SmilesDrawer?: SmilesRenderer }).SmilesDrawer;
    if (!renderer) { setStatus("Molecular renderer unavailable. SMILES is shown below."); return; }
    let active = true;
    const failure = () => { if (active) setStatus("Invalid SMILES example; no molecular drawing is available."); };
    try {
      renderer.parse(column.example, tree => {
        if (!active || !canvas.current) return;
        try { new renderer.Drawer({ width: 300, height: 200, isomeric: true }).draw(tree, id, "light", false); setStatus(""); } catch { failure(); }
      }, failure);
    } catch { failure(); }
    return () => { active = false; };
  }, [column.example, id]);
  return <div className="metadata-molecule">
    {column.example && <><ColumnTarget column={column}><canvas ref={canvas} id={id} width={300} height={200} hidden={!!status} role="img" aria-label={`Molecular structure for ${column.label || column.name}`} /></ColumnTarget>{status && <p role="status">{status}</p>}</>}
    <ColumnTarget column={column}><code>{previewValue(column)}</code></ColumnTarget>
  </div>;
}

export function ClassificationPreview({ columns }: { columns: PreviewColumn[] }) {
  const rows = classificationRows(columns);
  return <section aria-label="Classification preview"><h3>Taxonomy levels</h3>
    {rows.length ? <div className="metadata-taxonomy-scroll"><ol className="metadata-taxonomy">{rows.map(({ level, lanes }, index) => <li key={level} data-classification-level={level}>
      {index > 0 && <div className="metadata-taxonomy-arrow" aria-label={`Down to level ${level}`}>↓</div>}
      <span className="metadata-taxonomy-level-label">Level {level}</span><div className="metadata-taxonomy-level-nodes">{lanes.filter(lane => lane.columns.length).map(({ tag, columns }) => <div className="metadata-taxonomy-lane" data-classification-tag={tag} key={tag} aria-label={`${tag === "default" ? "Default classification" : tag}, level ${level}`}>
        {columns.map(c => <div className="metadata-taxonomy-node" key={c.name}>
        <ColumnTarget column={c}><strong>{c.label || c.name}</strong><span>{tag === "default" ? "Default classification" : tag}</span><span>{previewValue(c)}</span>{c.default_column && <small>Default from {c.default_column}</small>}</ColumnTarget>
      </div>)}</div>)}</div>
    </li>)}</ol></div> : <p>No visible classification columns are configured.</p>}
    <p>Levels descend from greatest to lowest; equal levels share a centered row. Within each level the default comes first, followed by named types alphabetically. Arrows show level order, not inferred ancestry between example values.</p>
  </section>;
}
