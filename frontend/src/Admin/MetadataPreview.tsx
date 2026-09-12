import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BookOpen, BranchesRight, ChevronDown, ChevronRight, Magnifier, Molecule } from "@gravity-ui/icons";
import { buildMetadataPreview, classificationRows, previewQuery, previewValue, type MetadataDocument, type MetadataPreviewModel, type PreviewColumn } from "./metadataPreviewModel";
import { safeMetadataLink } from "../shared/metadataType";
import Autocomplete from "../SearchApp/Autocomplete";
import { Container } from "../shared/ui";
import { InfoTip } from "../shared/ui/InfoTip";

const views = ["Search", "Results table", "Classification"] as const;
type EditColumn = (column: PreviewColumn) => void;
const EditColumnContext = createContext<EditColumn | undefined>(undefined);
function ColumnTarget({ column, children }: { column: PreviewColumn; children: ReactNode }) {
  const onEditColumn = useContext(EditColumnContext);
  return onEditColumn ? <button type="button" className="metadata-column-target" data-preview-sheet={column.sheet} data-preview-column={column.name}
    aria-label={`Edit ${column.sheet}.${column.name}`} onClick={() => onEditColumn(column)}>{children}</button> : <>{children}</>;
}

export default function MetadataPreview({ document, onEditColumn, onOpenEditor, editorOpen = false }: { document?: MetadataDocument; onEditColumn?: EditColumn; onOpenEditor?: () => void; editorOpen?: boolean }) {
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
    {model.errors.length > 0 ? <div role="status"><h3>Preview unavailable</h3><ul>{model.errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div> : <>
      {view === "Search" && <SearchPreview columns={model.search} />}
      {view === "Results table" && <ResultsPreview model={model} />}
      {view === "Classification" && <ClassificationPreview columns={model.classification} />}
      {model.warnings.length > 0 && <ul className="metadata-preview-warnings">{model.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      {model.sourceOnly.length > 0 && <p>Preserved source-only sheets (not joined into public views): {model.sourceOnly.join(", ")}.</p>}
    </>}
  </aside></EditColumnContext.Provider>;
}

export function SearchPreview({ columns }: { columns: PreviewColumn[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [open, setOpen] = useState({ species: true, chemical: true });
  const [submitted, setSubmitted] = useState(false);
  const query = previewQuery(columns, values);
  return <section aria-label="Search preview">
    <div className="metadata-preview-scroll" role="region" aria-label="Public search form" tabIndex={0}>
    <form className="search-form metadata-public-search" onSubmit={e => { e.preventDefault(); setSubmitted(true); }}>
      <h2>Search</h2>
      {([['species', 'Species', BranchesRight], ['chemical', 'Chemicals', Molecule]] as const).map(([domain, title, Icon], index) => <div key={domain} style={{ marginBottom: 12 }}>
        <button type="button" className="section-toggle" aria-expanded={open[domain]} onClick={() => setOpen(previous => ({ ...previous, [domain]: !previous[domain] }))}>
          <span style={{ display: "flex", color: "var(--color-muted)", flexShrink: 0 }} aria-hidden>{open[domain] ? <ChevronDown /> : <ChevronRight />}</span>
          <h2><Icon width={22} height={22} aria-hidden />{title}</h2>
        </button>
        {open[domain] && <ul>{columns.filter(c => c.domain === domain).map(c => <li key={c.name} style={{ width: 400, position: "relative" }}>
          <div><InfoTip text={c.description || ""} /> <ColumnTarget column={c}>{c.label || c.name}:</ColumnTarget>{columns.indexOf(c) > 0 && <span className="metadata-search-and">AND</span>}<br />
            <Autocomplete ariaLabel={c.label || c.name} value={values[c.name] ?? ""} placeholder="Enter..." style={{ position: "relative", left: "20%", width: 300, height: 30, borderColor: "var(--color-border)" }}
              onChange={value => setValues(previous => ({ ...previous, [c.name]: value }))} onSelect={() => undefined}
              fetchSuggestions={async query => (c.set_choices?.length ? c.set_choices : c.example ? [c.example] : []).filter(value => value.toLowerCase().includes(query.toLowerCase()))} />
            <hr style={{ border: 0, margin: 0, height: 15 }} />
          </div>
          <small className="metadata-search-example"><ColumnTarget column={c}>{previewValue(c)}</ColumnTarget></small>
        </li>)}{!columns.some(c => c.domain === domain) && <li>No searchable fields in this group.</li>}</ul>}
        {index === 0 && <hr style={{ border: "1px solid var(--color-border)" }} />}
      </div>)}
      <button type="submit" className="btn btn-primary metadata-search-submit">Search <Magnifier aria-hidden /></button>
    </form>
    </div>
    <h3>Sample query</h3><output className="metadata-preview-query">{query || (submitted ? "Enter at least one parameter." : "Enter a value above to see the query.")}</output>
    <small>Suggestions use only the draft’s examples and set choices. Search displays this query without requesting data.</small>
  </section>;
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
