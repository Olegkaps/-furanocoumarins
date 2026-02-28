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
      <br />
      <SearchLine setSearchResponse={setSearchResponse} />
      <br />
      {!isEmpty(searchResponse) && (
        <div>
          {searchResponse["data"]?.length === 0 ? (
            <EmptyResponse />
          ) : (
            <SearchLink path="/tree" text="Phylogenetic Tree" />
          )}
        </div>
      )}
      <br />
      <ResultTableOrNull {...filteredResponse} />
      <br />
    </>
  );
}
