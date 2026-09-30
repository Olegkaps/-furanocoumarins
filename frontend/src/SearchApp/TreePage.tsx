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
import PhilogeneticTreeOrNull from "./PhylogeneticTree";
import { useCompareSeries } from "./QueryCompareBar";
import { PageTour } from "../shared/tour/PageTour";
import { inspectComparePayloads } from "../shared/schemaGuard";

export function AppPhilogeneticTree() {
  const [searchParams] = useSearchParams();
  const primaryQuery = searchParams.get("query") ?? "";
  const { series, colorsByQuery, primaryRaw, hiddenQueries, minusQueries } =
    useCompareSeries(primaryQuery);
  const compareIssue = inspectComparePayloads(series.map(item => item.response));
  const { minusResponses, plusSeries } = useMemo(
    () => compareIssue ? { minusResponses: [], plusSeries: [] } : subtractMinusFromCompareSeries(series, hiddenQueries),
    [series, hiddenQueries, compareIssue],
  );
  const fallbackResponse = useMemo(
    () =>
      compareIssue || plusSeries.length > 0 || hiddenQueries.includes(primaryQuery.trim()) ||
      minusQueries.includes(primaryQuery.trim())
        ? {}
        : subtractMinusResponses(filterResponse(primaryRaw), minusResponses),
    [
      plusSeries,
      compareIssue,
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
  const compareModeActive =
    plusSeries.length > 1 || minusResponses.length > 0 || hiddenQueries.length > 0;
  const showEmptyResponse =
    !compareModeActive && !isEmpty(baseResponse) && baseResponse["data"]?.length === 0;

  return (
    <>
      <FullNavigation />
      {compareIssue ? <p role="alert" className="empty-state">{compareIssue} Clear the API cache and reload this page.</p> : <>
      <PageTour tourId="tree" />
      <div className="page-toolbar">
        <SearchLine tourTarget="tree-query" />
        {showEmptyResponse ? (
          <EmptyResponse />
        ) : hasVisibleData ? (
          <SearchLink path="/table" text="Result Table" />
        ) : null}
      </div>
      <PhilogeneticTreeOrNull
        response={baseResponse}
        compareSeries={plusSeries}
        colorsByQuery={colorsByQuery}
        primaryQuery={displayQuery}
        compareBarPrimaryQuery={primaryQuery}
      />
      </>}
    </>
  );
}
