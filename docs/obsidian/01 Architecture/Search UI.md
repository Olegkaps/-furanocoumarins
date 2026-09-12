# Search UI

The public UI lets users search furanocoumarin data, inspect result tables,
compare query sets, browse phylogenetic trees, reopen history, inspect cache
entries, and read editable project/substance pages.

## Routes

- `/about` - project documentation page.
- `/search` - query builder for species and chemical fields.
- `/table` - result table for the active query and compare set.
- `/tree` - phylogenetic tree for the active query and compare set.
- `/history` - browser-local query history.
- `/cache` - browser-local API cache inspection and clearing.
- `/page/:smiles` - editable substance page.
- `/reference/:article_id` - reference details.
- `/admin` and `/admin/metadata` - authenticated admin workflows.

Route wiring lives in [App.tsx](../../../frontend/src/App.tsx).

## Help On Pages

Most public and admin pages mount the shared `PageTour` help control. It renders
a floating question-mark button, auto-opens 450 ms after first page load until
that tour is marked done in local storage, and can pulse when the user appears
idle, rage-clicks, or scrolls back and forth. Steps target page elements through
`data-tour` attributes. Some steps dispatch a `fuco-tour` prepare event before
measurement so closed UI sections open for the tour. The button title changes
with the nudge reason:

- `Need a hand? Open the page tour`
- `Stuck? The page tour explains the controls`
- `Looking for something? Try the page tour`
- `Show page tour`

Tour content is defined centrally in
[tourSteps.ts](../../../frontend/src/shared/tour/tourSteps.ts). Current tours:

- `about` - navigation and project documentation.
- `search` - query fields, field info, autocomplete, and submit.
- `table` - query bar, tree jump, number/count modes, compare, download,
  chemical/species panels, references, and attribute info.
- `tree` - query bar, table jump, classification, number mode, rank depth,
  compare, pan/zoom, collapse/open subtree, and find.
- `history` - saved groups, reopen, and clear.
- `cache` - cached entries, refresh, and clear.
- `admin` - table actions, create table, and table list.

## Query And Compare Flow

- The query string is stored in the URL as `query`.
- Extra compare queries are stored in `cmp`.
- Table and tree pages share `SearchLine` and preserve the same query params
  when jumping between `/table` and `/tree`.
- Compare query colors are assigned from `COMPARE_QUERY_COLORS`.
- Tree number chips use the selected number mode: chemicals, articles, or all
  records.

## Code Links

- [Search page](../../../frontend/src/SearchApp/SearchApp.tsx)
- [Shared query line and Table/Tree links](../../../frontend/src/SearchApp/SearchLine.tsx)
- [Result table](../../../frontend/src/SearchApp/ResultTable.tsx)
- [Tree page wrapper](../../../frontend/src/SearchApp/TreePage.tsx)
- [Phylogenetic tree](../../../frontend/src/SearchApp/PhylogeneticTree.tsx)
- [Compare-query URL helpers](../../../frontend/src/SearchApp/compareQueries.ts)
- [Search HTTP handler](../../../backend/admin/internal/presentation/http/search/handler.go)
- [Search service](../../../backend/admin/internal/application/search/service.go)
- [Page tour component](../../../frontend/src/shared/tour/PageTour.tsx)
- [Help nudge heuristics](../../../frontend/src/shared/tour/useHelpNudge.ts)

## Related Notes

- [[Metadata versions]]
- [[Import pipeline]]
- [[Auth master]]
