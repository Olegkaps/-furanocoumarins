import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { cachedGet } from "../shared/apiCache";
import { api } from "../shared/api";
import { applyQuerySuggestion, completionKey, queryColumns, queryContext, querySuggestions, queryValueRequestKey, scheduleQueryValues } from "./queryCompletion";
import type { QueryColumn, QuerySuggestion } from "./queryCompletion";
import "./QueryInput.css";
import { parseStructureOptions } from "./StructureOptions";
import { MoleculePreview } from "./MoleculePreview";



type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string; onChange: (value: string) => void;
};

export function QueryInput({ value, onChange, onKeyDown, onFocus, onBlur, onSelect, ...props }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
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
      const response = await api.get(`/autocomplete/${encodeURIComponent(column)}`, { params: { value: prefix, ...(context.column?.smiles ? { mode: "structure", ...options } : {}) }, signal });
      return response.data?.values;
    }, (values) => setRemote({ key: requestKey, values }));
  }, [requestKey, baseRequestKey, focused, dismissed, context.column?.smiles]);

  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    input.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [value]);

  useEffect(() => {
    if (selected >= 0) document.getElementById(`${id}-${selected}`)?.scrollIntoView?.({ block: "nearest" });
  }, [id, selected]);

  const choose = (suggestion: QuerySuggestion) => {
    const next = applyQuerySuggestion(value, context, suggestion);
    pendingCaret.current = next.caret;
    setCaret(next.caret);
    setActive(-1);
    onChange(next.value);
    input.current?.focus();
  };

  return <div className="query-input">
    <input {...props} ref={input} type="text" value={value} autoComplete="off"
      role="combobox" aria-autocomplete="list" aria-expanded={open}
      aria-controls={open ? id : undefined} aria-activedescendant={selected >= 0 ? `${id}-${selected}` : undefined}
      aria-describedby={[props["aria-describedby"], showValueHint ? `${id}-hint` : undefined].filter(Boolean).join(" ") || undefined}
      onChange={(event) => {
        setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
        setDismissed(false); setActive(-1); onChange(event.currentTarget.value);
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
