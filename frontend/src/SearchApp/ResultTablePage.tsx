import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { isEmpty } from "../shared/api";
import FullNavigation from "../FullNavigation/FullNavigation";
import { SearchLine, EmptyResponse, SearchLink } from "./SearchLine";
import { filterResponse } from "./searchApi";
import {
  subtractMinusFromCompareSeries,
  subtractMinusResponses,
} from "./compareMinus";
import ResultTableOrNull from "./ResultTable";
import { useCompareSeries } from "./QueryCompareBar";
import { PageTour } from "../shared/tour/PageTour";
import { canShowPhylogeneticTree } from "./treeTaxonomy";

export function AppResultTable() {
  const [searchParams] = useSearchParams();
  const primaryQuery = searchParams.get("query") ?? "";
  const { series, colorsByQuery, primaryRaw, hiddenQueries, minusQueries } =
    useCompareSeries(primaryQuery);
  const { minusResponses, plusSeries } = useMemo(
    () => subtractMinusFromCompareSeries(series, hiddenQueries),
    [series, hiddenQueries],
  );
  const fallbackResponse = useMemo(
    () =>
      plusSeries.length > 0 || hiddenQueries.includes(primaryQuery.trim()) ||
      minusQueries.includes(primaryQuery.trim())
        ? {}
        : subtractMinusResponses(filterResponse(primaryRaw), minusResponses),
    [
      plusSeries,
      primaryRaw,
      hiddenQueries,
      minusQueries,
      minusResponses,
      primaryQuery,
    ],
  );
  const baseResponse = plusSeries[0]?.response ?? fallbackResponse;
  const displayQuery = plusSeries[0]?.query ?? primaryQuery;
  const hasVisibleData = plusSeries.length > 0
    ? plusSeries.some((series) => series.response.data?.length > 0)
    : baseResponse.data?.length > 0;
  const treeAvailable = useMemo(
    () => canShowPhylogeneticTree(baseResponse, plusSeries, searchParams.get("tag") || "original"),
    [baseResponse, plusSeries, searchParams],
  );
  const compareModeActive =
    plusSeries.length > 1 || minusResponses.length > 0 || hiddenQueries.length > 0;
  const showEmptyResponse =
    !compareModeActive && !isEmpty(baseResponse) && baseResponse["data"]?.length === 0;

  return (
    <>
      <FullNavigation />
      <PageTour tourId="table" />
      <div className="page-toolbar">
        <SearchLine tourTarget="table-query" />
        {showEmptyResponse ? (
          <EmptyResponse />
        ) : hasVisibleData ? (
          <SearchLink path="/tree" text="Phylogenetic Tree" disabled={!treeAvailable} />
        ) : null}
      </div>
      <br />
      <ResultTableOrNull
        {...baseResponse}
        compareSeries={plusSeries}
        colorsByQuery={colorsByQuery}
        primaryQuery={displayQuery}
        compareBarPrimaryQuery={primaryQuery}
      />
      <br />
    </>
  );
}
