import { useCallback, useEffect, useRef, useState } from "react";
import { canLoadPreviews, countSource, optionalSourcesFor, previewSource, resolveProviderTaxa, sourcesFor, unavailableSourcesFor, type OmicsCount, type OmicsRecord, type OmicsSource, type OmicsStatus, type OmicsTaxon, type OmicsType, type ProviderTaxon } from "./omics";
import "./OmicsPreview.css";
import OmicsRecordList from "./OmicsRecordList";
import { isNumericProvider, storedProviderID, type StoredProviderIDs } from "./taxonIdMapping";
import { api } from "../shared/api";

export type { OmicsCount, OmicsSource, OmicsType } from "./omics";

type PreviewState = { status: OmicsStatus; taxon?: ProviderTaxon; choices?: ProviderTaxon[]; counts: OmicsCount[]; records: Partial<Record<OmicsSource, OmicsRecord[]>>; message?: string; mappingVersion?: number };
type MappingResult = { ids: StoredProviderIDs; version?: number; error?: string };
const emptyState: PreviewState = { status: "loading", counts: [], records: {} };
const sourceName: Record<OmicsSource, string> = {
  ncbi: "NCBI", ena: "ENA", uniprot: "UniProt", geo: "NCBI GEO", biostudies: "BioStudies / ArrayExpress",
  "ensembl-plants": "Ensembl Plants", pride: "PRIDE (experimental projects)", metabolights: "MetaboLights",
};
const typeName: Record<OmicsType, string> = {
  genome: "Genomes", "chloroplast-genome": "Chloroplast nucleotide records", "mitochondrial-genome": "Mitochondrial nucleotide records",
  transcriptome: "Transcriptomes", "sequencing-library": "Sequencing libraries", expression: "Expression studies",
  proteome: "Proteomes & proteomics", metabolome: "Metabolomics studies",
};

function now() { return new Date().toISOString(); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "External provider is unavailable"; }
function providerIdentity(source: OmicsSource, taxon: OmicsTaxon, resolved: ProviderTaxon, ids?: StoredProviderIDs): string | undefined {
  return ["geo", "biostudies", "metabolights", "pride"].includes(source) ? `organism:${taxon.title.trim()}` : (storedProviderID(source, ids) ?? resolved.taxId) || undefined;
}

/** A transient public-data check. Counts are not scientific-data claims and are never sent through the app API. */
export default function OmicsPreview({ taxon, onCounts }: { taxon: OmicsTaxon; onCounts?: (counts: OmicsCount[]) => void }) {
  const [type, setType] = useState<OmicsType>("genome");
  const [sources, setSources] = useState<OmicsSource[]>(sourcesFor("genome", taxon));
  const [selectedTaxon, setSelectedTaxon] = useState<ProviderTaxon | null>(null);
  const [state, setState] = useState<PreviewState>(emptyState);
  const [refresh, setRefresh] = useState(0);
  const notify = useRef(onCounts);
  notify.current = onCounts;
  const taxonName = taxon.title.trim();

  const setSelectedType = useCallback((next: OmicsType) => {
    setType(next);
    setSources(sourcesFor(next, taxon));
  }, [taxon]);
  const toggleSource = useCallback((source: OmicsSource) => setSources(current => current.includes(source) ? current.filter(value => value !== source) : [...current, source]), []);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const update = (next: PreviewState) => { if (alive) setState(next); };
    if (!taxonName) { update({ status: "error", counts: [], records: {}, message: "This taxon has no scientific name to look up." }); return () => controller.abort(); }
    if (sources.length === 0) {
      update({ status: "ready", counts: [], records: {}, message: unavailableSourcesFor(type, taxon).length ? "No selected provider has a documented descendant count for this higher taxon." : "Choose at least one source." });
      return () => controller.abort();
    }
    update(emptyState);
    const mappingRequest: Promise<MappingResult> = api.get<{ version?: number; ids: StoredProviderIDs }>(`/taxa/${taxon.rank}/external-ids`, { params: taxon.id ? { id: taxon.id } : { name: taxonName }, signal: controller.signal })
      .then(({ data }) => ({ ids: data.ids ?? {}, version: data.version }))
      .catch(error => {
        const status = error?.response?.status;
        if (status === 404) return { ids: {} as StoredProviderIDs, version: undefined };
        if (status !== 409) return { ids: {} as StoredProviderIDs, version: undefined, error: "Taxon-ID mapping lookup is unavailable; numeric provider identity is unknown." };
        throw error;
      });
    void mappingRequest.then(async mapping => {
      // Exact IDs and organism-label providers never depend on ENA's name lookup.
      // Only the numeric sources with no mapping wait for an exact ENA taxon.
      const directSources = mapping.error ? sources.filter(source => !isNumericProvider(source)) : sources.filter(source => !isNumericProvider(source) || !!storedProviderID(source, mapping.ids));
      const unresolvedSources = mapping.error ? [] : sources.filter(source => isNumericProvider(source) && !storedProviderID(source, mapping.ids));
      const unknown = (items: OmicsSource[], message: string) => items.map(source => ({ source, type, count: null, status: "error" as const, countedAt: now(), message }));
      const mappingVersion = mapping.version && mapping.version > 0 ? mapping.version : undefined;
      const count = async (items: OmicsSource[], resolved: ProviderTaxon) => Promise.all(items.map(async source => {
        const id = providerIdentity(source, taxon, resolved, mapping.ids) ?? "";
        try { return { source, type, providerTaxonId: id || undefined, count: await countSource(taxon, source, type, id, controller.signal), status: "ready" as const, countedAt: now() }; }
        catch (error) { return { source, type, providerTaxonId: id || undefined, count: null, status: "error" as const, countedAt: now(), message: errorMessage(error) }; }
      }));
      const publish = async (resolved: ProviderTaxon, counts: OmicsCount[], activeSources: OmicsSource[], message?: string) => {
        if (controller.signal.aborted || !alive) return;
        const failed = counts.some(item => item.status !== "ready");
        const total = counts.reduce((sum, item) => sum + (item.count ?? 0), 0);
        update({ status: failed ? "error" : "loading", taxon: resolved, counts, records: {}, mappingVersion, message: message ?? (failed ? "One or more external counts are unavailable; the aggregate is unknown." : undefined) });
        notify.current?.(counts);
        if (failed || total > 300) {
          if (!failed) update({ status: "ready", taxon: resolved, counts, records: {}, mappingVersion, message: `Matching records total ${total}; previews are limited to 300.` });
          return;
        }
        const previews = await Promise.all(activeSources.map(async source => {
          const item = counts.find(value => value.source === source);
          const id = item?.providerTaxonId ?? "";
          try { return { source, records: item?.count === 0 ? [] : await previewSource(taxon, source, type, id, controller.signal, item?.count ?? 0) }; }
          catch (error) { return { source, records: [], error: errorMessage(error) }; }
        }));
        const previewFailure = previews.find(preview => preview.error)?.error;
        if (!controller.signal.aborted && alive) update({ status: previewFailure ? "error" : "ready", taxon: resolved, counts, records: Object.fromEntries(previews.map(preview => [preview.source, preview.records])), mappingVersion, message: previewFailure ? `Record preview unavailable: ${previewFailure}` : undefined });
      };
      const placeholder = { taxId: "", scientificName: taxonName };
      const directCounts = await count(directSources, placeholder);
      if (mapping.error) { await publish(placeholder, [...directCounts, ...unknown(sources.filter(isNumericProvider), mapping.error)], directSources); return; }
      if (!unresolvedSources.length) { await publish(placeholder, directCounts, directSources); return; }
      let choices: ProviderTaxon[];
      try { choices = await resolveProviderTaxa(taxonName, controller.signal); }
      catch (error) { await publish(placeholder, [...directCounts, ...unknown(unresolvedSources, `External taxonomy lookup failed: ${errorMessage(error)}`)], directSources); return; }
      if (!choices.length) { await publish(placeholder, [...directCounts, ...unknown(unresolvedSources, "No exact ENA scientific-name match was found.")], directSources); return; }
      const selected = choices.find(choice => choice.taxId === selectedTaxon?.taxId);
      if (!selected && choices.length > 1) {
        const counts = [...directCounts, ...unknown(unresolvedSources, "Choose an exact external taxonomy record before counting this source.")];
        update({ status: "ambiguous", choices, taxon: placeholder, counts, records: {}, mappingVersion, message: "Choose an exact external taxonomy record. Mapped provider counts are shown below; unresolved sources remain unknown." });
        notify.current?.(counts);
        return;
      }
      const resolved = selected ?? choices[0];
      const fallbackCounts = await count(unresolvedSources, resolved);
      await publish(resolved, [...directCounts, ...fallbackCounts], [...directSources, ...unresolvedSources]);
    }).catch(error => {
      if (controller.signal.aborted) return;
      if (error?.response?.status === 409) update({ status: "error", counts: [], records: {}, message: "This legacy species route is ambiguous, so external ID lookup is disabled. Open the taxon through its source-record link." });
      else update({ status: "error", counts: [], records: {}, message: errorMessage(error) });
    });
    return () => { alive = false; controller.abort(); };
  }, [taxon, taxonName, type, sources, refresh, selectedTaxon]);

  const chooseTaxon = (choice: ProviderTaxon) => {
    // The selected exact identity is represented in title only for this refresh, never persisted or guessed.
    setSelectedTaxon(choice);
  };
  const canPreview = state.status === "ready" && canLoadPreviews(state.counts);
  const providerLink = (source: OmicsSource, providerTaxonId?: string) => {
    const taxId = providerTaxonId || state.taxon?.taxId;
    if (source === "biostudies") return "https://www.ebi.ac.uk/biostudies/arrayexpress/studies";
    if (source === "pride") return "https://www.ebi.ac.uk/pride/archive/";
    // MetaboLights documents organism labels, not NCBI-taxonomy matching. It has
    // a direct species link only; higher taxa must not be presented as descendants.
    if (source === "metabolights") return taxon.rank === 0 ? `https://www.ebi.ac.uk/metabolights/search?organism.organismName=${encodeURIComponent(taxonName)}` : undefined;
    if (source === "geo") return `https://www.ncbi.nlm.nih.gov/gds/?term=${encodeURIComponent(`"${taxonName}"[Organism] AND gse[Entry Type]`)}`;
    if (!taxId) return undefined;
    if (source === "ensembl-plants") return `https://plants.ensembl.org/Multi/Search/Results?q=${encodeURIComponent(taxonName)}`;
    if (source === "ena") { const result = type === "genome" ? "assembly" : type === "transcriptome" ? "tsa_set" : "read_experiment"; return `https://www.ebi.ac.uk/ena/browser/search?query=${encodeURIComponent(`${taxon.rank > 0 ? "tax_tree" : "tax_eq"}(${taxId})`)}&result=${result}`; }
    if (source === "uniprot") return `https://www.uniprot.org/proteomes?query=${encodeURIComponent(`taxonomy_id:${taxId}`)}`;
    if (type === "genome") return `https://www.ncbi.nlm.nih.gov/datasets/genome/?taxon=${encodeURIComponent(taxId)}`;
    const term = `txid${taxId}[Organism:exp]${type === "transcriptome" ? " AND tsa[filter]" : type === "chloroplast-genome" ? " AND chloroplast[filter]" : type === "mitochondrial-genome" ? " AND mitochondrion[filter]" : ""}`;
    return `https://www.ncbi.nlm.nih.gov/${type === "sequencing-library" ? "sra" : "nuccore"}/?term=${encodeURIComponent(term)}`;
  };

  return <section className="omics-preview" aria-label="External data availability">
    <div className="omics-preview__heading"><div><h2>External data availability</h2><p>Live public-provider check; not a local dataset inventory.</p></div><button type="button" onClick={() => setRefresh(value => value + 1)}>Refresh</button></div>
    <fieldset><legend>Record type</legend>{(Object.keys(typeName) as OmicsType[]).map(value => <label key={value}><input type="radio" name="omics-type" checked={type === value} onChange={() => setSelectedType(value)} />{typeName[value]}</label>)}</fieldset>
    <fieldset><legend>Sources</legend>{[...sourcesFor(type, taxon), ...optionalSourcesFor(type, taxon)].map(source => <label key={source}><input type="checkbox" checked={sources.includes(source)} onChange={() => toggleSource(source)} />{sourceName[source]}</label>)}</fieldset>
    {state.mappingVersion !== undefined && <p className="omics-preview__scope">Taxon-ID mapping v{state.mappingVersion} checked; missing IDs use exact-name resolution.</p>}
    <p className="omics-preview__scope">External taxonomy scope: ENA uses {taxon.rank > 0 ? "its tax_tree descendant search" : "an exact taxon search"}; NCBI, UniProt, and Ensembl Plants use their provider taxonomy queries. GEO expands its indexed Organism field; BioStudies / ArrayExpress, PRIDE, and MetaboLights use exact provider organism labels for species only. This is external-provider scope, not a claim about local taxon membership. Totals sum provider records; sources can overlap.</p>
    {state.status === "ambiguous" && <div className="omics-preview__notice"><p>{state.message}</p>{state.choices?.map(choice => <button type="button" key={choice.taxId} onClick={() => chooseTaxon(choice)}>{choice.scientificName} ({choice.rank ?? "rank unknown"}; taxon {choice.taxId})</button>)}</div>}
    {state.message && state.status !== "ambiguous" && <p className="omics-preview__notice">{state.message}</p>}
    {state.counts.length > 0 && <ul className="omics-preview__counts">{state.counts.map(count => <li key={`${count.source}:${count.type}`}><strong>{sourceName[count.source]}</strong>: {count.status === "ready" ? count.count : "unknown"}{providerLink(count.source, count.providerTaxonId) && <> — <a href={providerLink(count.source, count.providerTaxonId)} target="_blank" rel="noreferrer">view provider</a></>}{count.status === "error" && <small> — {count.message}</small>}</li>)}</ul>}
    {unavailableSourcesFor(type, taxon).length > 0 && <ul className="omics-preview__counts">{unavailableSourcesFor(type, taxon).map(source => <li key={source}><strong>{sourceName[source]}</strong>: unknown{providerLink(source) && <> — <a href={providerLink(source)} target="_blank" rel="noreferrer">view provider</a></>}<small> — species-level organism searches only; descendant counts are unavailable.</small></li>)}</ul>}
    {state.status === "loading" && <p role="status">Checking providers and loading records…</p>}
    {canPreview && <div className="omics-preview__records">{state.counts.map(count => <OmicsRecordList key={`${count.source}:${type}:${taxonName}`} name={sourceName[count.source]} count={count.count ?? 0} records={state.records[count.source] ?? []} />)}</div>}
  </section>;
}
