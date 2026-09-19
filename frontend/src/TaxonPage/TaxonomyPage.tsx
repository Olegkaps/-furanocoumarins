import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import FullNavigation from "../FullNavigation/FullNavigation";
import { EditablePageContent } from "../features/editable-page/EditablePageContent";
import { useEditablePage } from "../features/editable-page/useEditablePage";
import { api } from "../shared/api";
import { cachedTaxon } from "../shared/apiCache";
import { EntityDetailTable } from "../SearchApp/EntityDetailTable";
import { fetchEntityPageDetails, sourceEntityPageDetails, type MetadataResponse, type SearchResponse, type SourceEntityRecord } from "../SearchApp/entityPageDetails";
import DataMeta from "../SearchApp/DataMeta";
import { type Taxon, taxonChildLabel, taxonPageName, taxonPath } from "./taxonPage";
import "./TaxonomyPage.css";

export function TaxonPageView({ taxon, details, children, renderTaxonLink, maxWidth = 800, renderDetailLabel }: { taxon: Taxon; details: { meta: DataMeta[]; row: Map<string, string> } | null; children: ReactNode; renderTaxonLink?: (link: { rank: number; name: string; source_column?: string }, content: ReactNode) => ReactNode; maxWidth?: string | number; renderDetailLabel?: (column: DataMeta) => ReactNode }) {
  const destination = (link: { rank: number; name: string; source_column?: string }, content: ReactNode) => renderTaxonLink ? renderTaxonLink(link, content) : <Link to={taxonPath(link)}>{content}</Link>;
  return <main className="taxon-page" style={{ position: "relative", padding: 24, maxWidth, margin: "0 auto" }}>
    <p style={{ color: "var(--color-muted)", margin: "0 0 4px" }}>Classification rank {taxon.rank}</p>
    <h1>{taxon.title}</h1>
    {(taxon.parent || taxon.children.length > 0) && <div className="taxon-navigation">
      {taxon.parent && <nav className="taxon-parent-nav" aria-label="Taxon navigation">{destination(taxon.parent, <><span aria-hidden="true">←</span><span><small>Parent taxon</small>{taxon.parent.name}</span></>)}{taxon.parent.source_column && <small className="taxon-parent-nav__source">from {taxon.parent.source_column}</small>}</nav>}
      {taxon.children.length > 0 && <section className="taxon-children"><details open><summary><span>Children</span><small>{taxon.children.length}</small></summary><ul>{taxon.children.map(child => <li className="taxon-children__item" key={`${child.rank}:${child.name}`}>{destination(child, taxonChildLabel(taxon, child))}{child.source_column && <small>from {child.source_column}</small>}</li>)}</ul></details></section>}
    </div>}
    {details && <aside aria-label="Species details" style={{ float: "right", width: "min(340px, 40%)", margin: "0 0 16px 24px" }}><EntityDetailTable meta={details.meta} row={details.row} hideEmpty renderLabel={renderDetailLabel} /></aside>}
    {children}
  </main>;
}

export default function TaxonPage() {
  const { rank: rawRank } = useParams<{ rank: string }>();
  const [params] = useSearchParams();
  const rank = Number(rawRank);
  const name = params.get("name")?.trim() ?? "";
  const valid = Number.isInteger(rank) && name !== "";
  const [taxon, setTaxon] = useState<Taxon | null>(null);
  const [loadingTaxon, setLoadingTaxon] = useState(valid);
  const [missing, setMissing] = useState(false);
  const [details, setDetails] = useState<{ meta: DataMeta[]; row: Map<string, string> } | null>(null);
  const state = useEditablePage(valid ? taxonPageName(rank, name) : null);

  useEffect(() => {
    if (!valid) return;
    let current = true;
    setLoadingTaxon(true);
    setMissing(false);
    // Taxonomy entries are cacheable only for the active dataset. Fetch its
    // identity afresh so another admin's activation cannot reuse an old key.
    void api.get<MetadataResponse>("/metadata", { params: { taxon_cache_key: Date.now() } }).then(({ data }) => cachedTaxon(rank, name, data.timestamp)).then(response => {
      if (current) setTaxon(response.data);
    }).catch(error => {
      if (current) setMissing(error?.response?.status === 404);
    }).finally(() => { if (current) setLoadingTaxon(false); });
    return () => { current = false; };
  }, [valid, rank, name]);

  useEffect(() => {
    setDetails(null);
    if (rank !== 0 || !taxon?.query_column) return;
    let current = true;
    const controller = new AbortController();
    // Do not reuse metadata or projections from the table that was active
    // before this page was opened; page fields are dataset-versioned.
    void api.get<MetadataResponse>("/metadata", { signal: controller.signal, params: { entity_page: Date.now() } }).then(async ({ data }) => {
      const joined = await fetchEntityPageDetails(data, "species", taxon.query_column!, name, controller.signal, async (params, signal) => (await api.get<SearchResponse>("/search", { params: { ...params, entity_page: data.timestamp }, signal })).data);
      if (joined || controller.signal.aborted) return joined;
      const source = await api.get<SourceEntityRecord>("/catalog/species/record", { params: { column: taxon.query_column, value: name }, signal: controller.signal });
      return sourceEntityPageDetails(source.data, "species");
    }).then(value => { if (current) setDetails(value); }).catch(() => { if (current) setDetails(null); });
    return () => { current = false; controller.abort(); };
  }, [rank, name, taxon?.query_column]);

  if (!valid || missing) return <><FullNavigation /><main style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}><p className="empty-state">Taxon page not found.</p></main></>;
  if (loadingTaxon || state.loading) return <><FullNavigation /><main style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>Loading…</main></>;
  if (!taxon) return null;

  return <><FullNavigation />
    <TaxonPageView taxon={taxon} details={details} maxWidth={state.editMode ? 1400 : 800} renderTaxonLink={(link, label) => <Link to={taxonPath(link)}>{label}</Link>}>
      <EditablePageContent {...state} />
    </TaxonPageView>
  </>;
}
