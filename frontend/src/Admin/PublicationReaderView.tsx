import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "@gravity-ui/icons";
import { buildEvidenceIndex, evidenceKey, coloredHighlightParts, findingHighlights, passageID, jumpToPassage } from "./publicationReaderModel";
import type { Analysis, Evidence, Finding, Publication } from "./publicationReaderModel";
import { PublicationMainExport } from "./PublicationMainExport";
const EMPTY_FINDINGS: Finding[] = [];

function Pagination({ page, pages, onChange, label }: { page: number; pages: number; onChange: (page: number) => void; label: string }) {
  return pages > 1 && <div className="publication-reader__pagination" aria-label={label}>
    <button className="btn" disabled={page === 0} onClick={() => onChange(page - 1)} aria-label={`Previous ${label}`} title={`Previous ${label}`}><ChevronLeft /></button>
    <span>{label}: {page + 1} / {pages}</span>
    <button className="btn" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)} aria-label={`Next ${label}`} title={`Next ${label}`}><ChevronRight /></button>
  </div>;
}

function Candidate({ finding, index, selected, onSelect, onEvidence }: { finding: Finding; index: ReturnType<typeof buildEvidenceIndex>; selected: boolean; onSelect: () => void; onEvidence: (evidence: Evidence, start: number) => void }) {
  const [evidencePage, setEvidencePage] = useState(0);
  return <section className="publication-reader__finding" data-selected={selected}>
    <h3><button className="publication-reader__pair" aria-pressed={selected} onClick={onSelect}>{finding.species || "Species not reported"} - {finding.chemical || "Chemical not reported"}</button></h3>
    <dl><dt>Species</dt><dd>{finding.species || "Not reported"}</dd>
      <dt>Methods</dt><dd>{finding.methods.length ? finding.methods.join(", ") : "Not reported"}</dd>
      <dt>Chirality</dt><dd>{finding.chirality || "Unknown"}</dd></dl>
    {finding.association_note && <p className="publication-reader__warning">{finding.association_note}</p>}
    {!finding.evidence.length && <p>No evidence supplied.</p>}
    {finding.evidence.slice(evidencePage * 5, evidencePage * 5 + 5).map((evidence, evidenceIndex) => {
      const match = index.matches.get(evidenceKey(evidence))!;
      const matches = match.starts;
      return <div className="publication-reader__evidence" key={evidenceIndex}>
        <strong>{evidence.field || "Evidence"}</strong>
        <blockquote>{evidence.quote || "Empty quotation"}</blockquote>
        {matches.length ? matches.map((start, occurrence) => <button className="btn" key={start} onClick={() => onEvidence(evidence, start)}>
          Page {evidence.page}{matches.length > 1 ? `, match ${occurrence + 1}` : ""}
        </button>) : !match.omitted && <p>Page {evidence.page}: exact quote not found.</p>}
        {match.omitted && <p>{match.unsearched ? "Highlight limit reached; this quote was not searched." : "More matches omitted (20 per quote; 1,000 highlights per document)."}</p>}
      </div>;
    })}
    <Pagination page={evidencePage} pages={Math.ceil(finding.evidence.length / 5)} onChange={setEvidencePage} label="Evidence" />
  </section>;
}

function Candidates({ analysis, index, selected, onSelect, onEvidence }: { analysis: Analysis; index: ReturnType<typeof buildEvidenceIndex>; selected: number; onSelect: (index: number) => void; onEvidence: (index: number, evidence: Evidence, start: number) => void }) {
  const page = Math.floor(selected / 10);
  return <>
    {analysis.findings.slice(page * 10, page * 10 + 10).map((finding, i) => <Candidate finding={finding} index={index} selected={page * 10 + i === selected} onSelect={() => onSelect(page * 10 + i)} onEvidence={(evidence, start) => onEvidence(page * 10 + i, evidence, start)} key={page * 10 + i} />)}
    <Pagination page={page} pages={Math.ceil(analysis.findings.length / 10)} onChange={page => onSelect(page * 10)} label="Candidates" />
  </>;
}

export function PublicationReaderView({ publication, analysis }: { publication: Publication; analysis: Analysis | null }) {
  const [selected, setSelected] = useState(0);
  const [active, setActive] = useState<{ evidence: Evidence; start: number } | undefined>();
  const findings = analysis?.findings ?? EMPTY_FINDINGS;
  const index = useMemo(() => buildEvidenceIndex(publication, analysis?.findings ?? []), [publication, analysis]);
  const ranges = useMemo(() => findingHighlights(publication, findings[selected], active?.evidence), [publication, findings, selected, active]);
  useEffect(() => { if (active) jumpToPassage(passageID(active.evidence.page, active.start)); }, [active]);
  function selectFinding(index: number) { setSelected(index); setActive(undefined); }
  return <><div className="publication-reader__workspace">
    <aside className="publication-reader__findings" aria-label="Model candidates">
      <h2>Model candidates {analysis && `(${findings.length})`}</h2>
      <p className="publication-reader__muted">Unverified extraction. Not curated records.</p>
      {!analysis && <p>No analysis yet.</p>}
      {analysis && !findings.length && <p>No candidates returned.</p>}
      {analysis && <Candidates analysis={analysis} index={index} selected={selected} onSelect={selectFinding} onEvidence={(index, evidence, start) => { setSelected(index); setActive({ evidence, start }); }} />}
    </aside>
    <section className="publication-reader__viewer" aria-label="Publication text" tabIndex={0}>
      <h2>{publication.title || "Untitled publication"}</h2>
      <div className="publication-reader__legend"><span data-kind="species">Species</span><span data-kind="chemical">Chemical</span><span data-kind="context">Context</span><span data-kind="active">Selected quotation</span></div>
      {publication.source_url && <p className="publication-reader__muted">Source: {publication.source_url}</p>}
      {!publication.pages.length && <p>No pages returned.</p>}
      {publication.pages.map(page => {
        const pageRanges = ranges.get(page.number) ?? [];
        return <article className="publication-reader__page" key={page.number} aria-label={`Page ${page.number}`}>
          <h3>Page {page.number}</h3>
          {page.text ? <div className="publication-reader__text">{coloredHighlightParts(page.text, pageRanges).map(part => part.kind
            ? <mark key={part.start} id={passageID(page.number, part.start)} tabIndex={-1} data-kind={part.kind}>{part.text}</mark>
            : part.text)}</div> : <p>No extracted text on this page.</p>}
        </article>;
      })}
    </section>
  </div>{analysis && findings.length > 0 && <PublicationMainExport findings={findings} selectedFinding={selected} onSelectFinding={selectFinding} />}</>;
}
