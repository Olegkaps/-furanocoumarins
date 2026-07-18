import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronRight, ArrowUpRightFromSquare } from "@gravity-ui/icons";

/** Search form that only updates the URL; data loading is owned by useCompareSeries. */
export function SearchLine() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("query") ?? "";
  const [request, setRequest] = useState(query);

  useEffect(() => {
    setRequest(query);
  }, [query]);

  return (
    <div className="card">
      <form
        className="main_form"
        onSubmit={(e) => {
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
          <input
            type="submit"
            value=""
            id="search-button"
            aria-label="Submit search"
          />
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
          search: searchParams.toString() ? `?${searchParams.toString()}` : "",
        }}
        target="_blank"
      >
        {text}
        <ArrowUpRightFromSquare />
      </Link>
    </div>
  );
}
