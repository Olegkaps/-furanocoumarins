import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import FullNavigation from "../FullNavigation/FullNavigation";
import { EditablePageContent } from "../features/editable-page/EditablePageContent";
import { useEditablePage } from "../features/editable-page/useEditablePage";
import { api } from "../shared/api";
import { type Taxon, taxonChildLabel, taxonPageName, taxonPath } from "./taxonPage";
import "./TaxonomyPage.css";

function TaxonLinkItem({ parent, taxon }: { parent: Taxon; taxon: { rank: number; name: string; source_column?: string } }) {
  return <li className="taxon-children__item"><Link to={taxonPath(taxon)}>{taxonChildLabel(parent, taxon)}</Link>{taxon.source_column && <small>from {taxon.source_column}</small>}</li>;
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
  const state = useEditablePage(valid ? taxonPageName(rank, name) : null);

  useEffect(() => {
    if (!valid) return;
    let current = true;
    setLoadingTaxon(true);
    setMissing(false);
    void api.get<Taxon>(`/taxa/${rank}`, { params: { name } }).then(response => {
      if (current) setTaxon(response.data);
    }).catch(error => {
      if (current) setMissing(error?.response?.status === 404);
    }).finally(() => { if (current) setLoadingTaxon(false); });
    return () => { current = false; };
  }, [valid, rank, name]);

  if (!valid || missing) return <><FullNavigation /><main style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}><p className="empty-state">Taxon page not found.</p></main></>;
  if (loadingTaxon || state.loading) return <><FullNavigation /><main style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>Loading…</main></>;
  if (!taxon) return null;

  return <>
    <FullNavigation />
    <main className="taxon-page" style={{ position: "relative", padding: 24, maxWidth: state.editMode ? 1400 : 800, margin: "0 auto" }}>
      <p style={{ color: "var(--color-muted)", margin: "0 0 4px" }}>Classification rank {taxon.rank}</p>
      <h1>{taxon.title}</h1>
      {(taxon.parent || taxon.children.length > 0) && <div className="taxon-navigation">
        {taxon.parent && <nav className="taxon-parent-nav" aria-label="Taxon navigation"><Link to={taxonPath(taxon.parent)}><span aria-hidden="true">←</span><span><small>Parent taxon</small>{taxon.parent.name}</span></Link>{taxon.parent.source_column && <small className="taxon-parent-nav__source">from {taxon.parent.source_column}</small>}</nav>}
        {taxon.children.length > 0 && <section className="taxon-children"><details open><summary><span>Children</span><small>{taxon.children.length}</small></summary><ul>{taxon.children.map(child => <TaxonLinkItem key={`${child.rank}:${child.name}`} parent={taxon} taxon={child} />)}</ul></details></section>}
      </div>}
      <EditablePageContent {...state} />
    </main>
  </>;
}
