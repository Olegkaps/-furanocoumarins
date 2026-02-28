import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronRight, ArrowUpRightFromSquare } from "@gravity-ui/icons";
import { fetchSearchResult, isDataFetched } from "./searchApi";

export function SearchLine({
  setSearchResponse,
}: {
  setSearchResponse: React.Dispatch<React.SetStateAction<{ [index: string]: any }>>;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  let query = searchParams.get("query");
  if (query === null) query = "";
  if (query !== "" && !isDataFetched) {
    fetchSearchResult(null, query, setSearchResponse).then(() => {});
  }
  const [request, setRequest] = useState(query);

  return (
    <div className="card">
      <form
        className="main_form"
        onSubmit={async (e) => {
          await fetchSearchResult(e, request, setSearchResponse);
          setSearchParams({ query: request });
        }}
      >
        <input
          type="text"
          className="search-teaxtarea"
          onChange={(e) => setRequest(e.target.value)}
          style={{ fontSize: "large" }}
          value={request}
        />
        <div
          style={{
            width: "5%",
            backgroundColor: "#fcdbf4",
            border: "1px solid grey",
            borderRadius: "10%",
          }}
        >
          <div style={{ position: "relative", right: "-30%", top: "10%" }}>
            <div style={{ position: "absolute" }}>
              <ChevronRight style={{ color: "grey" }} />
            </div>
          </div>
          <div style={{ width: "100%", height: "100%", position: "relative" }}>
            <input
              type="submit"
              value=""
              id="search-button"
              style={{
                width: "100%",
                height: "100%",
                position: "absolute",
                opacity: 0,
              }}
            />
          </div>
        </div>
      </form>
    </div>
  );
}

export function EmptyResponse() {
  return (
    <p
      style={{
        width: "100%",
        padding: "auto",
        textAlign: "center",
        fontSize: "larger",
        fontWeight: 600,
      }}
    >
      No data for given request
    </p>
  );
}

export function SearchLink({ path, text }: { path: string; text: string }) {
  const [searchParams] = useSearchParams();
  return (
    <label
      style={{
        position: "absolute",
        top: "15%",
        left: "0.5%",
        padding: "8px",
        backgroundColor: "#ffbe85",
        whiteSpace: "break-spaces",
        maxWidth: "120px",
        border: "3px solid grey",
        borderRadius: "10px",
      }}
    >
      <p>Go&nbsp;to:</p>
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
    </label>
  );
}
