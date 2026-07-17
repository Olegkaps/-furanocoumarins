import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRightFromSquare, Check, Copy } from "@gravity-ui/icons";
import { api } from "../api";
import {
  doiHref,
  fetchArticleBibtex,
  formatAuthors,
  formatCitationPlain,
  parseBibtex,
  type BibtexEntry,
} from "../bibtex";
import "./CitationPopover.css";

async function loadBibtex(articleId: string): Promise<string> {
  return fetchArticleBibtex(articleId, async (id) => {
    const res = await api.get(`/article/${encodeURIComponent(id)}`).catch((err) => err.response);
    if (!res || res.status >= 400) {
      throw new Error(res?.data?.error ?? `Failed to load ${id}`);
    }
    return String(res.data?.val ?? "");
  });
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

function CitationBody({
  entry,
  raw,
  articleId,
}: {
  entry: BibtexEntry;
  raw: string;
  articleId: string;
}) {
  const [copied, setCopied] = useState<"citation" | "bibtex" | null>(null);

  const markCopied = (kind: "citation" | "bibtex") => {
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const authors = formatAuthors(entry.author);
  const venue = entry.journal || entry.booktitle;
  let journalInfo = venue ?? "";
  if (venue) {
    if (entry.volume) journalInfo += `, ${entry.volume}`;
    if (entry.number) journalInfo += `(${entry.number})`;
    if (entry.pages) journalInfo += `: ${entry.pages}`;
  }

  return (
    <div className="citation-popover__body">
      <div className="citation-popover__id">{articleId}</div>
      <div className="citation-popover__text">
        {authors && <strong>{/[.!?]$/.test(authors) ? `${authors} ` : `${authors}. `}</strong>}
        {entry.title && <em>{entry.title}</em>}
        {entry.title && ". "}
        {journalInfo && <>{journalInfo}. </>}
        {entry.year && <>({entry.year})</>}
      </div>
      <div className="citation-popover__actions">
        {entry.doi && (
          <a
            className="citation-popover__action"
            href={doiHref(entry.doi)}
            target="_blank"
            rel="noopener noreferrer"
          >
            DOI <ArrowUpRightFromSquare width={14} height={14} />
          </a>
        )}
        {!entry.doi && entry.url && (
          <a
            className="citation-popover__action"
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Link <ArrowUpRightFromSquare width={14} height={14} />
          </a>
        )}
        <button
          type="button"
          className="citation-popover__action"
          onClick={() => {
            void copyText(formatCitationPlain(entry)).then(() => markCopied("citation"));
          }}
        >
          {copied === "citation" ? <Check width={14} height={14} /> : <Copy width={14} height={14} />}
          Copy citation
        </button>
        <button
          type="button"
          className="citation-popover__action"
          onClick={() => {
            void copyText(raw).then(() => markCopied("bibtex"));
          }}
        >
          {copied === "bibtex" ? <Check width={14} height={14} /> : <Copy width={14} height={14} />}
          Copy BibTeX
        </button>
      </div>
    </div>
  );
}

type PanelPos = { left: number; top: number; placement: "above" | "below" };

export function CitationPopover({ articleId }: { articleId: string }) {
  const tipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const clearCloseTimer = () => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => setOpen(false), 220);
  };

  const openPanel = () => {
    clearCloseTimer();
    setOpen(true);
  };

  useEffect(() => {
    if (!open || raw != null || error != null) return;
    let cancelled = false;
    setLoading(true);
    void loadBibtex(articleId)
      .then((text) => {
        if (!cancelled) {
          setRaw(text);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, articleId, raw, error]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }

    const update = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const panelWidth = Math.min(420, window.innerWidth * 0.7);
      const panelHeight = panelRef.current?.offsetHeight ?? 180;
      let left = rect.left;
      if (left + panelWidth > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - panelWidth - 8);
      }
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      const placement: "above" | "below" =
        spaceAbove >= panelHeight + 12 || spaceAbove > spaceBelow ? "above" : "below";
      const top =
        placement === "above" ? rect.top - 8 : rect.bottom + 8;
      setPos({ left, top, placement });
    };

    update();
    // Reposition after content loads (height changes)
    const raf = window.requestAnimationFrame(update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, loading, raw, error]);

  useEffect(() => () => clearCloseTimer(), []);

  const entry = raw ? parseBibtex(raw) : null;

  const panel =
    open &&
    createPortal(
      <div
        ref={panelRef}
        id={tipId}
        role="tooltip"
        className={`citation-popover__panel citation-popover__panel--${pos?.placement ?? "above"}`}
        style={
          pos
            ? {
                left: pos.left,
                top: pos.top,
                transform: pos.placement === "above" ? "translateY(-100%)" : "none",
              }
            : { visibility: "hidden", left: 0, top: 0 }
        }
        onMouseEnter={openPanel}
        onMouseLeave={scheduleClose}
      >
        {loading && <p className="citation-popover__status">Loading…</p>}
        {!loading && error && <p className="citation-popover__status is-error">{error}</p>}
        {!loading && !error && raw === "" && (
          <p className="citation-popover__status">No BibTeX for this id.</p>
        )}
        {!loading && !error && raw && !entry && (
          <p className="citation-popover__status is-error">Could not parse BibTeX.</p>
        )}
        {!loading && !error && raw && entry && (
          <CitationBody entry={entry} raw={raw} articleId={articleId} />
        )}
      </div>,
      document.body,
    );

  return (
    <span
      className="citation-popover"
      onMouseEnter={openPanel}
      onMouseLeave={scheduleClose}
      onFocus={openPanel}
      onBlur={scheduleClose}
    >
      <button
        ref={triggerRef}
        type="button"
        className="citation-popover__trigger"
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
      >
        {articleId}
      </button>
      {panel}
    </span>
  );
}

export function CitationRefList({ value }: { value: string }) {
  const ids = value
    .split(/\s*,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) return null;

  return (
    <span className="citation-ref-list">
      {ids.map((id, i) => (
        <span key={`${id}-${i}`} className="citation-ref-list__item">
          {i > 0 && <span className="citation-ref-list__sep">, </span>}
          <CitationPopover articleId={id} />
        </span>
      ))}
    </span>
  );
}
