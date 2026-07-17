import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronRight, ArrowUpRightFromSquare } from "@gravity-ui/icons";
import { fetchSearchResult } from "./searchApi";

export function SearchLine({
  setSearchResponse,
}: {
  setSearchResponse: React.Dispatch<React.SetStateAction<{ [index: string]: any }>>;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("query") ?? "";
  const [request, setRequest] = useState(query);

  useEffect(() => {
    setRequest(query);
  }, [query]);

  useEffect(() => {
    if (query === "") {
      setSearchResponse({});
      return;
    }
    let cancelled = false;
    fetchSearchResult(null, query, (data) => {
      if (!cancelled) {
        setSearchResponse(data);
      }
    }).then(() => {});
    return () => {
      cancelled = true;
    };
  }, [query, setSearchResponse]);

  return (
    <div className="card">
      <form
        className="main_form"
        onSubmit={async (e) => {
          e.preventDefault();
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            if (request.trim() === "") {
              next.delete("query");
            } else {
              next.set("query", request);
            }
            return next;
          });
        }}
      >
        <input
          type="text"
          className="search-teaxtarea"
          onChange={(e) => setRequest(e.target.value)}
          value={request}
          aria-label="Search query"
        />
        <div className="search-submit" title="Search">
          <ChevronRight width={22} height={22} style={{ color: "white" }} />
          <input type="submit" value="" id="search-button" aria-label="Submit search" />
        </div>
      </form>
    </div>
  );
}

export function EmptyResponse() {
  return <p className="empty-state">No data for given request</p>;
}

export function SearchLink({ path, text }: { path: string; text: string }) {
  const [searchParams] = useSearchParams();
  return (
    <div className="goto-chip">
      <p>Go to:</p>
      <Link
        to={{
          pathname: path,
          search: "?query=" + searchParams.get("query"),
        }}
        target="_blank"
      >
        {text}
        <ArrowUpRightFromSquare />
      </Link>
    </div>
  );
}
