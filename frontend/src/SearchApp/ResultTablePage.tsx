import { useSearchParams } from "react-router-dom";
import { isEmpty } from "../shared/api";
import FullNavigation from "../FullNavigation/FullNavigation";
import { SearchLine, EmptyResponse, SearchLink } from "./SearchLine";
import { filterResponse } from "./searchApi";
import ResultTableOrNull from "./ResultTable";
import { useCompareSeries } from "./QueryCompareBar";
import { PageTour } from "../shared/tour/PageTour";

export function AppResultTable() {
  const [searchParams] = useSearchParams();
  const primaryQuery = searchParams.get("query") ?? "";
  const { series, colorsByQuery, primaryRaw, hiddenQueries } =
    useCompareSeries(primaryQuery);
  const visibleSeries = series.filter((s) => !hiddenQueries.includes(s.query));
  const primaryHidden = hiddenQueries.includes(primaryQuery.trim());
  const baseResponse =
    visibleSeries[0]?.response ??
    (primaryHidden ? {} : filterResponse(primaryRaw));
  const displayQuery = visibleSeries[0]?.query ?? primaryQuery;

  return (
    <>
      <FullNavigation />
      <PageTour tourId="table" />
      <div className="page-toolbar">
        <SearchLine tourTarget="table-query" />
        {!isEmpty(baseResponse) &&
          (baseResponse["data"]?.length === 0 ? (
            <EmptyResponse />
          ) : (
            <SearchLink path="/tree" text="Phylogenetic Tree" />
          ))}
      </div>
      <br />
      <ResultTableOrNull
        {...baseResponse}
        compareSeries={visibleSeries}
        colorsByQuery={colorsByQuery}
        primaryQuery={displayQuery}
        compareBarPrimaryQuery={primaryQuery}
      />
      <br />
    </>
  );
}
