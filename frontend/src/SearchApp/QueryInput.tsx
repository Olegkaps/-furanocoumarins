import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { cachedAutocomplete, cachedGet } from "../shared/apiCache";
import { applyQuerySuggestion, completionKey, queryColumns, queryContext, querySuggestions, queryValueRequestKey, scheduleQueryValues } from "./queryCompletion";
import type { QueryColumn, QuerySuggestion } from "./queryCompletion";
import "./QueryInput.css";
import { parseStructureOptions } from "./StructureOptions";
import { MoleculePreview } from "./MoleculePreview";
import { insertDelimiter, reconcileDelimiterPairs, registerAutoQuotePair, removePairedDelimiter, replaceSuggestionWithDelimiter, typeAutoClosingQuote } from "./queryDelimiters";
import type { DelimiterPair } from "./queryDelimiters";



type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string; onChange: (value: string) => void;
};

export function QueryInput({ value, onChange, onKeyDown, onFocus, onBlur, onSelect, ...props }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const pendingValue = useRef<string | null>(null);
  const delimiterPairs = useRef<DelimiterPair[]>([]);
  const [columns, setColumns] = useState<QueryColumn[]>([]);
  const [caret, setCaret] = useState(value.length);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const [remote, setRemote] = useState<{ key: string; values: unknown }>();
  const context = useMemo(() => queryContext(value, caret, columns), [value, caret, columns]);
  const options = parseStructureOptions(context.operator);
  const baseRequestKey = queryValueRequestKey(context);
  const requestKey = baseRequestKey ? JSON.stringify([baseRequestKey, context.column?.smiles ? options : null]) : "";
  const suggestions = useMemo(() => querySuggestions(context, columns, remote?.key === requestKey ? remote.values : []), [context, columns, remote, requestKey]);
  const open = focused && !dismissed && suggestions.length > 0;
  const showValueHint = focused && !dismissed && context.kind === "value" && context.prefix.trim() === "";
  const selected = open && active < suggestions.length ? active : -1;

  useEffect(() => {
    let live = true;
    cachedGet("/metadata").then((response) => {
      if (live) setColumns(queryColumns(response.data?.metadata));
    }).catch(() => { /* Search remains usable when metadata is unavailable. */ });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!focused || dismissed || !requestKey) return;
    const [column, prefix] = JSON.parse(baseRequestKey) as [string, string];
    const options = JSON.parse(requestKey)[1];
    return scheduleQueryValues(async (signal) => {
      const response = await cachedAutocomplete(`/autocomplete/${encodeURIComponent(column)}`, { value: prefix, ...(context.column?.smiles ? { mode: "structure", ...options } : {}) }, { signal });
      return response.data?.values;
    }, (values) => setRemote({ key: requestKey, values }));
  }, [requestKey, baseRequestKey, focused, dismissed, context.column?.smiles]);

  useLayoutEffect(() => {
    if (pendingValue.current === value) pendingValue.current = null;
    else delimiterPairs.current = [];
    if (pendingCaret.current === null) return;
    input.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [value]);

  const emitChange = (nextValue: string) => {
    pendingValue.current = nextValue;
    onChange(nextValue);
  };

  useEffect(() => {
    if (selected >= 0) document.getElementById(`${id}-${selected}`)?.scrollIntoView?.({ block: "nearest" });
  }, [id, selected]);

  const choose = (suggestion: QuerySuggestion) => {
    const delimiter = suggestion.insert === "(" ? replaceSuggestionWithDelimiter(value, context.start, context.end, "(", delimiterPairs.current) : null;
    const next = delimiter ?? applyQuerySuggestion(value, context, suggestion);
    delimiterPairs.current = delimiter?.pairs ?? registerAutoQuotePair(next.value, next.caret, reconcileDelimiterPairs(value, next.value, delimiterPairs.current));
    pendingCaret.current = next.caret;
    setCaret(next.caret);
    setActive(-1);
    emitChange(next.value);
    input.current?.focus();
  };

  return <div className="query-input">
    <input {...props} ref={input} type="text" value={value} autoComplete="off"
      role="combobox" aria-autocomplete="list" aria-expanded={open}
      aria-controls={open ? id : undefined} aria-activedescendant={selected >= 0 ? `${id}-${selected}` : undefined}
      aria-describedby={[props["aria-describedby"], showValueHint ? `${id}-hint` : undefined].filter(Boolean).join(" ") || undefined}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        delimiterPairs.current = reconcileDelimiterPairs(value, nextValue, delimiterPairs.current);
        setCaret(event.currentTarget.selectionStart ?? nextValue.length);
        setDismissed(false); setActive(-1); emitChange(nextValue);
      }}
      onSelect={(event) => {
        const next = event.currentTarget.selectionStart ?? value.length;
        if (next !== caret) { setCaret(next); setActive(-1); }
        onSelect?.(event);
      }}
      onFocus={(event) => { setFocused(true); setDismissed(false); onFocus?.(event); }}
      onBlur={(event) => { setFocused(false); setActive(-1); onBlur?.(event); }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") { setDismissed(true); setActive(-1); if (open) event.preventDefault(); return; }
        const start = event.currentTarget.selectionStart ?? value.length;
        const end = event.currentTarget.selectionEnd ?? start;
        if (event.key === "'" && start === end) {
          const quote = typeAutoClosingQuote(value, start, delimiterPairs.current);
          if (quote) {
            event.preventDefault();
            delimiterPairs.current = quote.pairs;
            pendingCaret.current = quote.caret;
            setCaret(quote.caret);
            if (quote.value !== value) emitChange(quote.value);
            return;
          }
        }
        if ((event.key === "(" || event.key === "'") && !event.altKey && !event.ctrlKey && !event.metaKey) {
          const inserted = insertDelimiter(value, start, end, event.key, delimiterPairs.current);
          event.preventDefault();
          delimiterPairs.current = inserted.pairs;
          pendingCaret.current = inserted.caret;
          setCaret(inserted.caret); setDismissed(false); setActive(-1); emitChange(inserted.value);
          return;
        }
        if (event.key === ")" && start === end) {
          const pair = delimiterPairs.current.find(({ close, delimiter }) => close === start && (delimiter === "(" ? ")" : "'") === event.key);
          if (pair) {
            event.preventDefault();
            pendingCaret.current = start + 1;
            setCaret(start + 1);
            return;
          }
        }
        if ((event.key === "Backspace" || event.key === "Delete") && start === end) {
          const removed = removePairedDelimiter(value, start, event.key, delimiterPairs.current);
          if (removed) {
            event.preventDefault();
            delimiterPairs.current = removed.pairs;
            pendingCaret.current = removed.caret;
            setCaret(removed.caret); setDismissed(false); setActive(-1); emitChange(removed.value);
            return;
          }
        }
        const action = completionKey(event.key, selected, open ? suggestions.length : 0);
        if (action.handled) {
          event.preventDefault(); event.stopPropagation();
          if (action.choose) choose(suggestions[selected]); else setActive(action.active);
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") setDismissed(false);
        onKeyDown?.(event);
      }} />
    {(open || showValueHint) && <div className="query-input__suggestions">
    {showValueHint && <p id={`${id}-hint`} className="query-input__hint" role="status">Start typing</p>}
    {open && <ul id={id} role="listbox" aria-label="Query suggestions">
      {suggestions.map((suggestion, index) => <li key={suggestion.insert} id={`${id}-${index}`}
        role="option" aria-selected={index === selected}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(suggestion)}>
        {context.kind === "value" && context.column?.smiles && <MoleculePreview smiles={suggestion.label} />}
        <div className="molecule-suggestion__text">
        <span>{suggestion.label}</span>
        {suggestion.detail && suggestion.detail !== suggestion.label && <small>{suggestion.detail}</small>}
        </div>
      </li>)}
    </ul>}
    </div>}
  </div>;
}
