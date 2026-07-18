import { useSearchParams } from "react-router-dom";
import { isEmpty } from "../shared/api";
import FullNavigation from "../FullNavigation/FullNavigation";
import { SearchLine, EmptyResponse, SearchLink } from "./SearchLine";
import { filterResponse } from "./searchApi";
import ResultTableOrNull from "./ResultTable";
import { useCompareSeries } from "./QueryCompareBar";

export function AppResultTable() {
  const [searchParams] = useSearchParams();
  const primaryQuery = searchParams.get("query") ?? "";
  const { series, colorsByQuery, primaryRaw } = useCompareSeries(primaryQuery);
  const filteredResponse = filterResponse(primaryRaw);

  return (
    <>
      <FullNavigation />
      <div className="page-toolbar">
        <SearchLine />
        {!isEmpty(primaryRaw) &&
          (primaryRaw["data"]?.length === 0 ? (
            <EmptyResponse />
          ) : (
            <SearchLink path="/tree" text="Phylogenetic Tree" />
          ))}
      </div>
      <br />
      <ResultTableOrNull
        {...filteredResponse}
        compareSeries={series}
        colorsByQuery={colorsByQuery}
        primaryQuery={primaryQuery}
      />
      <br />
    </>
  );
}
