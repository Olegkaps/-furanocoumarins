import { useSearchParams } from "react-router-dom";
import { isEmpty } from "../shared/api";
import FullNavigation from "../FullNavigation/FullNavigation";
import { SearchLine, EmptyResponse, SearchLink } from "./SearchLine";
import { filterResponse } from "./searchApi";
import PhilogeneticTreeOrNull from "./PhylogeneticTree";
import { useCompareSeries } from "./QueryCompareBar";
import { PageTour } from "../shared/tour/PageTour";

export function AppPhilogeneticTree() {
  const [searchParams] = useSearchParams();
  const primaryQuery = searchParams.get("query") ?? "";
  const { series, colorsByQuery, primaryRaw } = useCompareSeries(primaryQuery);
  const filteredResponse = filterResponse(primaryRaw);

  return (
    <>
      <FullNavigation />
      <PageTour tourId="tree" />
      <div className="page-toolbar">
        <SearchLine tourTarget="tree-query" />
        {!isEmpty(primaryRaw) &&
          (primaryRaw["data"]?.length === 0 ? (
            <EmptyResponse />
          ) : (
            <SearchLink path="/table" text="Result Table" />
          ))}
      </div>
      <PhilogeneticTreeOrNull
        response={filteredResponse}
        compareSeries={series}
        colorsByQuery={colorsByQuery}
        primaryQuery={primaryQuery}
      />
    </>
  );
}
