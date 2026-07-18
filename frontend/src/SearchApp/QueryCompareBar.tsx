import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Xmark } from "@gravity-ui/icons";
import config from "../config";
import { NewFeatureHint } from "../shared/ui/NewFeatureHint";
import {
  readCompareQueriesFromParams,
  syncCompareColors,
  writeCompareQueriesToParams,
} from "./compareQueries";
import { fetchSearchData, filterResponse } from "./searchApi";
import { isEmpty } from "../shared/api";

export type CompareSeries = {
  query: string;
  color: string;
  response: { [index: string]: any };
  /** ISO timestamp when this query’s response was received. */
  fetchedAt: string;
};

type CompareLoadSnapshot = {
  raw: Record<string, { [index: string]: any }>;
  at: Record<string, string>;
};

type CompareLoadListener = (snap: CompareLoadSnapshot, done: boolean) => void;

type CompareLoadEntry = {
  listeners: Set<CompareLoadListener>;
  partial: CompareLoadSnapshot;
  done: boolean;
  promise: Promise<CompareLoadSnapshot>;
};

/**
 * Shared sequential loader keyed by the query list. Survives React Strict Mode
 * remounts so we do not abort after the first request and re-hit the network
 * for the rest (cache stays authoritative for warm reloads).
 */
const compareLoads = new Map<string, CompareLoadEntry>();

function subscribeCompareLoad(
  queries: string[],
  onUpdate: CompareLoadListener,
): () => void {
  const key = queries.join("\u0001");
  let entry = compareLoads.get(key);

  if (!entry) {
    const listeners = new Set<CompareLoadListener>();
    const partial: CompareLoadSnapshot = { raw: {}, at: {} };
    const entryRef: CompareLoadEntry = {
      listeners,
      partial,
      done: false,
      promise: Promise.resolve(partial),
    };

    entryRef.promise = (async () => {
      for (const q of queries) {
        const data = await fetchSearchData(q);
        if (data != null) {
          partial.raw[q] = data;
          partial.at[q] = new Date().toISOString();
          const snap = {
            raw: { ...partial.raw },
            at: { ...partial.at },
          };
          listeners.forEach((l) => l(snap, false));
        }
      }
      entryRef.done = true;
      const finalSnap = {
        raw: { ...partial.raw },
        at: { ...partial.at },
      };
      listeners.forEach((l) => l(finalSnap, true));
      return finalSnap;
    })();
    // Keep finished loads in the map for the tab lifetime so Strict Mode
    // remounts reuse results without touching the network again.

    compareLoads.set(key, entryRef);
    entry = entryRef;
  }

  entry.listeners.add(onUpdate);
  onUpdate(
    { raw: { ...entry.partial.raw }, at: { ...entry.partial.at } },
    entry.done,
  );

  return () => {
    entry?.listeners.delete(onUpdate);
  };
}

export function useCompareSeries(primaryQuery: string): {
  series: CompareSeries[];
  colorsByQuery: Record<string, string>;
  extraQueries: string[];
  /** Raw (unfiltered) primary response for page chrome / empty states. */
  primaryRaw: { [index: string]: any };
  loading: boolean;
} {
  const [searchParams] = useSearchParams();
  const extraQueries = useMemo(
    () => readCompareQueriesFromParams(searchParams),
    [searchParams],
  );

  const allQueries = useMemo(() => {
    const list: string[] = [];
    const primary = primaryQuery.trim();
    if (primary !== "") list.push(primary);
    extraQueries.forEach((q) => {
      if (!list.includes(q)) list.push(q);
    });
    return list.slice(0, config["MAX_COMPARE_QUERIES"]);
  }, [primaryQuery, extraQueries]);

  const queriesKey = allQueries.join("\u0001");

  const [colorsByQuery, setColorsByQuery] = useState<Record<string, string>>(
    {},
  );
  const [rawByQuery, setRawByQuery] = useState<
    Record<string, { [index: string]: any }>
  >({});
  const [fetchedAtByQuery, setFetchedAtByQuery] = useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = useState(false);
  const prevQueriesRef = useRef<string[]>([]);

  useEffect(() => {
    const prevOrdered = prevQueriesRef.current;
    setColorsByQuery((prev) =>
      syncCompareColors(allQueries, prev, prevOrdered),
    );
    prevQueriesRef.current = allQueries;
  }, [queriesKey]);

  useEffect(() => {
    if (allQueries.length === 0) {
      setRawByQuery({});
      setFetchedAtByQuery({});
      setLoading(false);
      return;
    }

    setLoading(true);
    return subscribeCompareLoad(allQueries, (snap, done) => {
      setRawByQuery(snap.raw);
      setFetchedAtByQuery(snap.at);
      if (done) setLoading(false);
    });
  }, [queriesKey]);

  const primary = primaryQuery.trim();
  const primaryRaw =
    primary !== "" && rawByQuery[primary] ? rawByQuery[primary] : {};

  const series: CompareSeries[] = allQueries
    .map((q) => {
      const raw = rawByQuery[q];
      const color = colorsByQuery[q];
      const fetchedAt = fetchedAtByQuery[q];
      if (!raw || !color || !fetchedAt || isEmpty(raw)) return null;
      return {
        query: q,
        color,
        response: filterResponse(raw),
        fetchedAt,
      };
    })
    .filter((s): s is CompareSeries => s != null);

  return { series, colorsByQuery, extraQueries, primaryRaw, loading };
}

export function QueryCompareBar({
  primaryQuery,
  colorsByQuery,
}: {
  primaryQuery: string;
  colorsByQuery: Record<string, string>;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const extras = readCompareQueriesFromParams(searchParams);
  const [draft, setDraft] = useState("");
  const maxExtra = Math.max(0, config["MAX_COMPARE_QUERIES"] - 1);
  const primary = primaryQuery.trim();
  const canAdd =
    primary !== "" && extras.length < maxExtra && draft.trim() !== "";

  const add = () => {
    const q = draft.trim();
    if (!q || !canAdd) return;
    if (q === primary || extras.includes(q)) {
      setDraft("");
      return;
    }
    setSearchParams((prev) => writeCompareQueriesToParams(prev, [...extras, q]));
    setDraft("");
  };

  const remove = (q: string) => {
    setSearchParams((prev) =>
      writeCompareQueriesToParams(
        prev,
        extras.filter((x) => x !== q),
      ),
    );
  };

  if (primary === "" && extras.length === 0) {
    return null;
  }

  return (
    <NewFeatureHint
      label="New"
      tip="Compare several search queries — counts are colored per query; zeros are hidden."
    >
      <div className="query-compare-bar">
        <p className="query-compare-bar__title">Compare queries</p>
        <ul className="query-compare-bar__list">
          {primary !== "" && (
            <li className="query-compare-bar__item">
              <span
                className="query-compare-bar__swatch"
                style={{ background: colorsByQuery[primary] }}
              />
              <span className="query-compare-bar__text" title={primary}>
                {primary}
              </span>
              <span className="query-compare-bar__tag">primary</span>
            </li>
          )}
          {extras.map((q) => (
            <li key={q} className="query-compare-bar__item">
              <span
                className="query-compare-bar__swatch"
                style={{ background: colorsByQuery[q] }}
              />
              <span className="query-compare-bar__text" title={q}>
                {q}
              </span>
              <button
                type="button"
                className="query-compare-bar__remove"
                title="Remove query"
                aria-label={`Remove ${q}`}
                onClick={() => remove(q)}
              >
                <Xmark width={14} height={14} />
              </button>
            </li>
          ))}
        </ul>
        {extras.length < maxExtra && (
          <div className="query-compare-bar__add">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="Add query to compare"
              aria-label="Add query to compare"
              disabled={primary === ""}
            />
            <button
              type="button"
              className="btn"
              disabled={!canAdd}
              onClick={add}
              title="Add query"
            >
              <Plus width={16} height={16} />
              Add
            </button>
          </div>
        )}
        <p className="query-compare-bar__hint">
          Up to {config["MAX_COMPARE_QUERIES"]} queries.
        </p>
      </div>
    </NewFeatureHint>
  );
}
