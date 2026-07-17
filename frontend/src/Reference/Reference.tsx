import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowUpRightFromSquare, Check, Copy } from "@gravity-ui/icons";
import { api } from "../shared/api";
import FullNavigation from "../FullNavigation/FullNavigation";
import {
  doiHref,
  formatAuthors,
  formatCitationPlain,
  parseBibtex,
} from "../shared/bibtex";

export function Reference() {
  const { article_id } = useParams();
  const [copied, setCopied] = useState<"citation" | "bibtex" | null>(null);
  const [referenceData, setReferenceData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!article_id) return;
    let cancelled = false;
    api
      .get("/article/" + encodeURIComponent(article_id))
      .catch((err) => err.response)
      .then((res) => {
        if (cancelled) return;
        if (!res || res.status >= 400) {
          setError(res?.data?.error ?? "Failed to load reference");
          setReferenceData("");
          return;
        }
        setReferenceData(String(res?.data?.val ?? ""));
      });
    return () => {
      cancelled = true;
    };
  }, [article_id]);

  const markCopied = (kind: "citation" | "bibtex") => {
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const entry = referenceData ? parseBibtex(referenceData) : null;
  const authors = entry ? formatAuthors(entry.author) : "";
  const venue = entry?.journal || entry?.booktitle;
  let journalInfo = venue ?? "";
  if (venue && entry) {
    if (entry.volume) journalInfo += `, ${entry.volume}`;
    if (entry.number) journalInfo += `(${entry.number})`;
    if (entry.pages) journalInfo += `: ${entry.pages}`;
  }

  return (
    <>
      <FullNavigation />
      <div style={{ maxWidth: 720, margin: "24px auto", padding: "0 16px" }}>
        <p style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>
          Tip: in the results table, hover a reference id to preview the citation without opening this page.
        </p>
        {referenceData === null && <p>Loading…</p>}
        {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}
        {referenceData !== null && !error && !entry && (
          <p style={{ color: "var(--color-danger)" }}>Could not parse BibTeX for this article.</p>
        )}
        {entry && (
          <div className="panel" style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 8, fontSize: "0.75rem", fontWeight: 700, color: "var(--color-muted)" }}>
              {article_id}
            </div>
            <div style={{ lineHeight: 1.5, marginBottom: 12 }}>
              {authors && <strong>{/[.!?]$/.test(authors) ? `${authors} ` : `${authors}. `}</strong>}
              {entry.title && <em>{entry.title}</em>}
              {entry.title && ". "}
              {journalInfo && <>{journalInfo}. </>}
              {entry.year && <>({entry.year})</>}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {entry.doi && (
                <a className="btn" href={doiHref(entry.doi)} target="_blank" rel="noopener noreferrer">
                  DOI <ArrowUpRightFromSquare width={14} height={14} />
                </a>
              )}
              {!entry.doi && entry.url && (
                <a className="btn" href={entry.url} target="_blank" rel="noopener noreferrer">
                  Link <ArrowUpRightFromSquare width={14} height={14} />
                </a>
              )}
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  await navigator.clipboard.writeText(formatCitationPlain(entry));
                  markCopied("citation");
                }}
              >
                {copied === "citation" ? <Check /> : <Copy />}
                &nbsp;Copy citation
              </button>
              {referenceData && (
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    await navigator.clipboard.writeText(referenceData);
                    markCopied("bibtex");
                  }}
                >
                  {copied === "bibtex" ? <Check /> : <Copy />}
                  &nbsp;Copy BibTeX
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
