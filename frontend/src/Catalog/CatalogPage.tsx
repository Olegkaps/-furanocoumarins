import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Archive, ChevronLeft, ChevronRight } from "@gravity-ui/icons";
import FullNavigation from "../FullNavigation/FullNavigation";
import { api } from "../shared/api";
import { formatAuthors, parseBibtex } from "../shared/bibtex";
import { cachedCatalogCountRequest, catalogPageNumber, classificationColumn, recordTitle, rememberCatalogPageNumber } from "./catalogModel";
import { MoleculePreview } from "../SearchApp/MoleculePreview";
import { substancePagePath } from "../shared/substanceUrl";
import "./CatalogPage.css";

type CatalogKind = "chemicals" | "species" | "publications";
type CatalogColumn = { column: string; name: string; type: string; description: string };
type CatalogResponse = {
  kind: CatalogKind;
  page_size: number;
  previous_cursor?: string;
  next_cursor?: string;
  columns: CatalogColumn[];
  items: Record<string, unknown>[];
};
type CatalogCount = {
  kind: CatalogKind;
  page_size: number;
  total: number;
  page_count: number;
};

const pageSize = 24;

const kinds: { id: CatalogKind; label: string }[] = [
  { id: "chemicals", label: "Chemicals" },
  { id: "species", label: "Species" },
  { id: "publications", label: "Publications" },
];

const catalogCountRequests = new Map<CatalogKind, Promise<CatalogCount>>();

function catalogSessionStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function textValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(", ");
  if (value == null) return "";
  return String(value).trim();
}

function columnValue(columns: CatalogColumn[], item: Record<string, unknown>, matcher: (column: CatalogColumn) => boolean): string {
  const column = columns.find(matcher);
  return column ? textValue(item[column.column]) : "";
}

function chemicalName(columns: CatalogColumn[], item: Record<string, unknown>): string {
  const names = columnValue(columns, item, (column) => /(?:^|_)(?:chemical_)?names?(?:$|_)/i.test(column.column) || /trivial name/i.test(column.name));
  return names.split("=").map((name) => name.trim()).find(Boolean) || recordTitle("chemicals", columns, item);
}

function SourceCard({ kind, columns, item }: { kind: Exclude<CatalogKind, "publications">; columns: CatalogColumn[]; item: Record<string, unknown> }) {
  const title = kind === "chemicals" ? chemicalName(columns, item) : recordTitle(kind, columns, item);
  const speciesColumn = classificationColumn(columns, 0);
  const species = speciesColumn ? textValue(item[speciesColumn]) : "";
  const smiles = columnValue(columns, item, (column) => /(?:^|\s)SMILES(?:\s|$)/i.test(column.type) || column.column.toLowerCase() === "smiles");
  const id = columnValue(columns, item, (column) => /(?:^|\s)primary(?:\s|$)/.test(column.type) || /^(?:id|.*_id)$/i.test(column.column));
  const destination = kind === "chemicals" && smiles
    ? substancePagePath(smiles)
    : kind === "species" && species
      ? `/taxon/0?name=${encodeURIComponent(species)}`
      : undefined;
  return <article className="catalog-card">
    <div className={kind === "chemicals" ? "catalog-card__chemical" : undefined}>
      <div className="catalog-card__main">
        <h2>{destination ? <Link to={destination}>{title}</Link> : title}</h2>
        {id && <span className="catalog-card__id">{id}</span>}
        {kind === "species" && <p className="catalog-card__note">Species source record</p>}
      </div>
      {kind === "chemicals" && smiles && <Link className="catalog-card__structure" to={destination!} aria-label={`Open chemical page for ${title}`}><MoleculePreview smiles={smiles} /></Link>}
    </div>
  </article>;
}

function PublicationCard({ item }: { item: Record<string, unknown> }) {
  const id = textValue(item.article_id);
  const raw = textValue(item.bibtex_text);
  const publication = parseBibtex(raw);
  return <article className="catalog-card catalog-card--publication">
    <h2><Link to={`/reference/${encodeURIComponent(id)}`}>{publication?.title || id}</Link></h2>
    {publication?.author && <p>{formatAuthors(publication.author)}</p>}
    <p className="catalog-card__publication-meta">{[publication?.journal || publication?.booktitle, publication?.year].filter(Boolean).join(" · ")}</p>
    <span className="catalog-card__id">{id}</span>
  </article>;
}

export default function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const rawKind = params.get("kind");
  const kind: CatalogKind = kinds.some((candidate) => candidate.id === rawKind) ? rawKind as CatalogKind : "chemicals";
  const cursor = params.get("cursor") || "";
  const before = params.get("before") || "";
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [count, setCount] = useState<CatalogCount | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    api.get<CatalogResponse>(`/catalog/${kind}`, { params: { cursor: cursor || undefined, before: before || undefined, page_size: pageSize }, signal: controller.signal })
      .then((response) => setData(response.data))
      .catch((requestError) => {
        if (requestError?.name !== "CanceledError") setError(requestError?.response?.data?.error || "Could not load the catalog.");
      });
    return () => controller.abort();
  }, [kind, cursor, before]);

  useEffect(() => {
    let active = true;
    setCount(null);
    // This intentionally does not depend on cursor navigation: the aggregate
    // is one separate request, while each page remains an index seek.
    const request = cachedCatalogCountRequest(catalogCountRequests, kind, () =>
      api.get<CatalogCount>(`/catalog/${kind}/count`, { params: { page_size: pageSize } })
        .then((response) => response.data)
    );
    request.then((response) => {
      if (active) setCount(response);
    }).catch(() => { /* A usable catalog page does not depend on its summary. */ });
    return () => { active = false; };
  }, [kind]);

  const summary = useMemo(() => {
    const shown = data?.items.length ?? 0;
    if (!count) return shown === pageSize ? `Showing ${pageSize} records` : `Showing ${shown} records`;
    return `${count.total} records · ${count.page_count} ${count.page_count === 1 ? "page" : "pages"}`;
  }, [data, count]);
  const currentPage = useMemo(() => catalogPageNumber(kind, cursor, before, catalogSessionStorage()), [kind, cursor, before]);
  const paginationSummary = useMemo(() => {
    if (count?.page_count === 0) return `${count.total} records · 0 pages`;
    const page = currentPage ? `Page ${currentPage}${count ? ` of ${count.page_count}` : ""}` : "Page number unavailable";
    return count ? `${page} · ${count.total} records` : page;
  }, [count, currentPage]);
  const navigateCursor = (name: "cursor" | "before", value: string) => {
    const destinationPage = currentPage == null ? null : name === "cursor" ? currentPage + 1 : currentPage - 1;
    if (destinationPage && destinationPage > 0) {
      rememberCatalogPageNumber(kind, name, value, destinationPage, catalogSessionStorage());
    }
    setParams({ kind, [name]: value });
  };

  return <>
    <FullNavigation pageName="catalog" />
    <main className="catalog-page">
      <header className="catalog-page__header">
        <h1><Archive width={28} height={28} aria-hidden /> Data catalog</h1>
        <p>Browse every imported source record, including chemicals and species that are not joined to an observation.</p>
      </header>
      <nav className="catalog-tabs" aria-label="Catalog type">
        {kinds.map((candidate) => <Link key={candidate.id} className={candidate.id === kind ? "is-active" : ""} aria-current={candidate.id === kind ? "page" : undefined} to={`/catalog?kind=${candidate.id}`}>{candidate.label}</Link>)}
      </nav>
      {!data && !error && <p className="catalog-status" aria-live="polite">Loading…</p>}
      {error && <div className="panel catalog-status is-error" role="alert"><strong>Catalog unavailable</strong><p>{error}</p></div>}
      {data && <>
        <div className="catalog-summary">{summary}</div>
        {data.items.length === 0 ? <p className="empty-state">No records.</p> : <div className="catalog-grid">
          {data.items.map((item, index) => kind === "publications"
            ? <PublicationCard key={textValue(item.article_id) || index} item={item} />
            : <SourceCard key={textValue(item[data.columns[0]?.column]) || index} kind={kind} columns={data.columns} item={item} />)}
        </div>}
        <nav className="catalog-pagination" aria-label="Catalog pages">
          <button type="button" className="btn" disabled={!data.previous_cursor} onClick={() => navigateCursor("before", data.previous_cursor!)}><ChevronLeft width={16} height={16} /> Previous</button>
          <span className="catalog-pagination__summary" aria-live="polite">{paginationSummary}</span>
          <button type="button" className="btn" disabled={!data.next_cursor} onClick={() => navigateCursor("cursor", data.next_cursor!)}>Next <ChevronRight width={16} height={16} /></button>
        </nav>
      </>}
    </main>
  </>;
}
