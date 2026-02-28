import { useState } from "react";
import { isEmpty } from "../shared/api";
import FullNavigation from "../FullNavigation/FullNavigation";
import { SearchLine, EmptyResponse, SearchLink } from "./SearchLine";
import { filterResponse } from "./searchApi";
import PhilogeneticTreeOrNull from "./PhylogeneticTree";

export function AppPhilogeneticTree() {
  const [searchResponse, setSearchResponse] = useState<{ [index: string]: any }>({});
  const [classificationTag, setClassificationTag] = useState("default");
  const filteredResponse = filterResponse(searchResponse);

  return (
    <>
      <FullNavigation />
      <br />
      <SearchLine setSearchResponse={setSearchResponse} />
      {!isEmpty(searchResponse) && (
        <div>
          {searchResponse["data"]?.length === 0 ? (
            <EmptyResponse />
          ) : (
            <SearchLink path="/table" text="Result Table" />
          )}
        </div>
      )}
      <PhilogeneticTreeOrNull
        response={filteredResponse}
        tag={classificationTag}
        setTag={setClassificationTag}
      />
      <br />
    </>
  );
}
