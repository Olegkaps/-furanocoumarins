import { useState } from "react";
import { isEmpty } from "../shared/api";
import FullNavigation from "../FullNavigation/FullNavigation";
import { SearchLine, EmptyResponse, SearchLink } from "./SearchLine";
import { filterResponse } from "./searchApi";
import ResultTableOrNull from "./ResultTable";

export function AppResultTable() {
  const [searchResponse, setSearchResponse] = useState<{ [index: string]: any }>({});
  const filteredResponse = filterResponse(searchResponse);

  return (
    <>
      <FullNavigation />
      <div className="page-toolbar">
        <SearchLine setSearchResponse={setSearchResponse} />
        {!isEmpty(searchResponse) &&
          (searchResponse["data"]?.length === 0 ? (
            <EmptyResponse />
          ) : (
            <SearchLink path="/tree" text="Phylogenetic Tree" />
          ))}
      </div>
      <br />
      <ResultTableOrNull {...filteredResponse} />
      <br />
    </>
  );
}
