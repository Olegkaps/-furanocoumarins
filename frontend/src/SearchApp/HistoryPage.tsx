import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRightFromSquare, ClockArrowRotateLeft, TrashBin } from "@gravity-ui/icons";
import FullNavigation from "../FullNavigation/FullNavigation";
import {
  clearQueryHistory,
  loadQueryHistory,
  type QueryHistoryEntry,
} from "../shared/queryHistory";
import { buildCompareSearchParams, syncCompareColors } from "./compareQueries";
import { CompareQueriesDisplay } from "./QueryCompareBar";

function formatHistoryTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function HistoryEntryCard({ entry }: { entry: QueryHistoryEntry }) {
  const colorsByQuery = useMemo(
    () => syncCompareColors(entry.queries, {}),
    [entry.queries],
  );
  const search = buildCompareSearchParams(entry.queries);

  return (
    <article className="query-history__card">
      <header className="query-history__card-head">
        <time className="query-history__time" dateTime={entry.at}>
          {formatHistoryTime(entry.at)}
        </time>
        <span className="query-history__count">
          {entry.queries.length}{" "}
          {entry.queries.length === 1 ? "query" : "queries"}
        </span>
      </header>
      <div className="query-compare-bar query-history__queries">
        <CompareQueriesDisplay
          queries={entry.queries}
          colorsByQuery={colorsByQuery}
        />
      </div>
      <div className="query-history__actions">
        <Link
          className="btn"
          to={{ pathname: "/tree", search: search ? `?${search}` : "" }}
        >
          Tree
          <ArrowUpRightFromSquare width={14} height={14} />
        </Link>
        <Link
          className="btn"
          to={{ pathname: "/table", search: search ? `?${search}` : "" }}
        >
          Table
          <ArrowUpRightFromSquare width={14} height={14} />
        </Link>
      </div>
    </article>
  );
}

export default function HistoryPage() {
  const [entries, setEntries] = useState<QueryHistoryEntry[]>(() =>
    loadQueryHistory(),
  );

  const clear = () => {
    if (entries.length === 0) return;
    if (!window.confirm("Clear all query history?")) return;
    clearQueryHistory();
    setEntries([]);
  };

  return (
    <>
      <FullNavigation pageName="history" />
      <div className="query-history">
        <header className="query-history__header">
          <h1 className="query-history__title">
            <ClockArrowRotateLeft width={28} height={28} aria-hidden />
            Query history
          </h1>
          <button
            type="button"
            className="btn"
            onClick={clear}
            disabled={entries.length === 0}
            title="Clear history"
          >
            <TrashBin width={16} height={16} />
            Clear history
          </button>
        </header>
        {entries.length === 0 ? (
          <p className="empty-state">No saved queries yet.</p>
        ) : (
          <div className="query-history__list">
            {entries.map((entry) => (
              <HistoryEntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
