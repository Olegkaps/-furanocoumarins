import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRightArrowLeft, ArrowUp, ChevronDown, ChevronRight, Magnifier, Xmark } from "@gravity-ui/icons";
import { findJsonMatches, nextJsonMatch, replaceJsonMatches } from "./jsonFind";

export default function MetadataJsonEditor({ value, onChange, enabled }: { value: string; onChange: (value: string) => void; enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [position, setPosition] = useState(0);
  const [navigation, setNavigation] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const highlights = useRef<HTMLSpanElement>(null);
  const activeHighlight = useRef<HTMLElement>(null);
  const findWidget = useRef<HTMLDivElement>(null);
  const revealMatch = useRef(false);
  const matches = useMemo(() => findJsonMatches(value, query, { matchCase, wholeWord }), [value, query, matchCase, wholeWord]);
  const active = Math.min(position, Math.max(0, matches.length - 1));
  const current = matches[active];
  const syncScroll = () => {
    if (highlights.current && textarea.current) {
      // Translate rather than independently scroll: the textarea's scrollbar
      // reduces its viewport, so the two layers have different scroll limits.
      highlights.current.style.transform = `translate(${-textarea.current.scrollLeft}px, ${-textarea.current.scrollTop}px)`;
    }
  };
  const close = () => { setOpen(false); textarea.current?.focus({ preventScroll: true }); };
  const showFind = (replace = false) => {
    const editor = textarea.current;
    const selection = editor?.value.slice(editor.selectionStart, editor.selectionEnd);
    if (selection && !selection.includes("\n")) { setQuery(selection); setPosition(0); }
    setOpen(true);
    revealMatch.current = true;
    setNavigation(value => value + 1);
    if (replace) setReplaceOpen(true);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
  };
  useEffect(() => {
    if (!enabled) return;
    const onShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && (key === "f" || (key === "h" && event.ctrlKey))) {
        event.preventDefault();
        showFind(key === "h" || event.altKey);
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  });
  useLayoutEffect(() => {
    const editor = textarea.current;
    const marker = activeHighlight.current;
    syncScroll();
    if (!open || !current || !editor || !marker || !revealMatch.current) return;
    revealMatch.current = false;
    editor.setSelectionRange(current.start, current.end);
    const mark = marker.getBoundingClientRect();
    const bounds = editor.getBoundingClientRect();
    if (mark.top < bounds.top || mark.bottom > bounds.top + editor.clientHeight) editor.scrollTop += mark.top - bounds.top - editor.clientHeight / 2;
    if (mark.left < bounds.left || mark.right > bounds.left + editor.clientWidth) editor.scrollLeft += mark.left - bounds.left - editor.clientWidth / 2;
    syncScroll();
    const widget = findWidget.current?.getBoundingClientRect();
    const visible = marker.getBoundingClientRect();
    if (widget && visible.right > widget.left && visible.left < widget.right && visible.top < widget.bottom && visible.bottom > widget.top) {
      editor.scrollTop -= widget.bottom + 8 - visible.top;
      syncScroll();
    }
  }, [open, current, navigation, replaceOpen]);
  const replace = (all: boolean) => {
    if (!enabled || !current) return;
    revealMatch.current = true;
    const changed = replaceJsonMatches(value, all ? matches : [current], replacement);
    const following = findJsonMatches(changed, query, { matchCase, wholeWord });
    const next = following.findIndex(match => match.start >= current.start + replacement.length);
    setPosition(all || next < 0 ? 0 : next);
    setNavigation(value => value + 1);
    onChange(changed);
  };
  const navigate = (backward = false) => {
    revealMatch.current = true;
    setNavigation(value => value + 1);
    setPosition(nextJsonMatch(matches.length, active, backward));
  };
  let end = 0;
  const marked = open && matches.length > 0;
  return <div className="metadata-json-editor" onKeyDown={event => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === "Enter" && open && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      if (event.target === input.current) navigate(event.shiftKey);
      else replace(event.ctrlKey || event.metaKey);
    }
  }}>
    <div className="metadata-json-tools"><span>Metadata JSON</span><button className="metadata-json-icon metadata-json-find-trigger" type="button" aria-label="Find / replace" title="Find / replace (Ctrl/Cmd+F)" disabled={!enabled} onClick={() => showFind()}><Magnifier /><span>Ctrl/Cmd+F</span></button></div>
    <div className={`metadata-json-surface${marked ? " has-matches" : ""}`}>
      {open && <div ref={findWidget} className="metadata-json-find" role="search" aria-label="Find in metadata JSON">
        <div className="metadata-json-find-row">
          <button className="metadata-json-icon" type="button" title="Toggle replace" aria-label="Toggle replace" aria-expanded={replaceOpen} disabled={!enabled} onClick={() => { revealMatch.current = true; setReplaceOpen(!replaceOpen); }}>{replaceOpen ? <ChevronDown /> : <ChevronRight />}</button>
          <div className="metadata-json-find-input">
            <input ref={input} aria-label="Find in JSON" placeholder="Find" disabled={!enabled} value={query} onChange={event => { revealMatch.current = true; setQuery(event.target.value); setPosition(0); }} />
            <button className="metadata-json-icon" type="button" title="Match case" aria-label="Match case" aria-pressed={matchCase} disabled={!enabled} onClick={() => { revealMatch.current = true; setMatchCase(!matchCase); setPosition(0); }}>Aa</button>
            <button className="metadata-json-icon metadata-json-whole-word" type="button" title="Match whole word" aria-label="Match whole word" aria-pressed={wholeWord} disabled={!enabled} onClick={() => { revealMatch.current = true; setWholeWord(!wholeWord); setPosition(0); }}>ab</button>
          </div>
          <div className="metadata-json-find-navigation">
            <span role="status" className="metadata-json-find-status">{query ? matches.length ? `${active + 1} of ${matches.length}` : "No results" : ""}</span>
            <button className="metadata-json-icon" type="button" title="Previous match (Shift+Enter)" aria-label="Previous match" disabled={!enabled || !current} onClick={() => navigate(true)}><ArrowUp /></button>
            <button className="metadata-json-icon" type="button" title="Next match (Enter)" aria-label="Next match" disabled={!enabled || !current} onClick={() => navigate()}><ArrowDown /></button>
            <button className="metadata-json-icon" type="button" title="Close JSON search (Escape)" aria-label="Close JSON search" onClick={close}><Xmark /></button>
          </div>
        </div>
        {replaceOpen && <div className="metadata-json-replace-row"><input aria-label="Replace with" placeholder="Replace" disabled={!enabled} value={replacement} onChange={event => setReplacement(event.target.value)} /><button className="metadata-json-icon" type="button" title="Replace (Enter)" aria-label="Replace" disabled={!enabled || !current} onClick={() => replace(false)}><ArrowRightArrowLeft /></button><button className="metadata-json-icon metadata-json-replace-all" type="button" title="Replace all (Ctrl/Cmd+Enter)" aria-label="Replace all" disabled={!enabled || !current} onClick={() => replace(true)}><ArrowRightArrowLeft /><span aria-hidden="true">all</span></button></div>}
      </div>}
      <pre className="metadata-json-highlights" aria-hidden="true"><span ref={highlights} className="metadata-json-highlight-content">{marked && matches.map((match, index) => {
        const before = value.slice(end, match.start);
        end = match.end;
        return <span key={match.start}>{before}<mark ref={index === active ? activeHighlight : undefined} className={index === active ? "is-active" : undefined}>{value.slice(match.start, match.end)}</mark></span>;
      })}{marked && value.slice(end)}{marked && "\n"}</span></pre>
      <textarea ref={textarea} aria-label="Metadata JSON" className="metadata-json" wrap="off" spellCheck={false} disabled={!enabled} value={value} onScroll={syncScroll} onChange={event => { revealMatch.current = false; onChange(event.target.value); }} />
    </div>
  </div>;
}
