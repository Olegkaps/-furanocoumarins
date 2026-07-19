export type TourId =
  | "search"
  | "about"
  | "table"
  | "tree"
  | "history"
  | "cache"
  | "admin";

export type TourPrepare = "table-select" | "search-open-species";

export type TourStep = {
  /** Single data-tour target */
  target?: string;
  /** Several data-tour targets (rings + arrows) */
  targets?: string[];
  title: string;
  body: string;
  /** Prefer side card (readable, stays in viewport). Default auto. */
  placement?: "auto" | "side" | "center";
  /** Side-effect while this step is active */
  prepare?: TourPrepare;
};

export const TOUR_STEPS: Record<TourId, TourStep[]> = {
  search: [
    {
      title: "Search",
      body: "Build a query from Species and Chemicals fields, then open results as a table.",
    },
    {
      target: "nav",
      title: "Navigation",
      body: "Top-left icons open Search, About, History, and Cache. The current page stays highlighted.",
      placement: "side",
    },
    {
      target: "search-section-species",
      title: "Species filters",
      body: "This section lists taxonomy and species fields. They combine with AND in the final query.",
      prepare: "search-open-species",
      placement: "side",
    },
    {
      target: "search-info-tip",
      title: "Field info (ⓘ)",
      body: "Hover or focus the info icon next to a field name to read what it means.",
      prepare: "search-open-species",
      placement: "side",
    },
    {
      target: "search-autocomplete",
      title: "Autocomplete",
      body: "Start typing in a field to see matching suggestions from the database, then pick one or keep editing.",
      prepare: "search-open-species",
      placement: "side",
    },
    {
      target: "search-section-chemicals",
      title: "Chemicals section",
      body: "Expand Chemicals the same way for chemical attributes. Info tips and autocomplete work there too.",
      placement: "side",
    },
    {
      target: "search-submit",
      title: "Run search",
      body: "Submit opens the results table with your query in the URL. You can refine it later on the table or tree.",
      placement: "side",
    },
  ],
  about: [
    {
      title: "Welcome",
      body: "This site explores furanocoumarins across plants and publications. This About page is the starting point — use the icons to open Search and other tools.",
    },
    {
      target: "nav",
      title: "Main navigation",
      body: "Search builds queries. History reopens past result groups. Cache shows stored API responses.",
      placement: "side",
    },
    {
      target: "about-content",
      title: "Project description",
      body: "Read the documentation here.",
      placement: "side",
    },
  ],
  table: [
    {
      title: "Results table",
      body: "Explore chemicals and species for your query. Hover to preview, click to focus, clear to go back. Compare several queries if needed.",
    },
    {
      target: "table-query",
      title: "Query bar",
      body: "Edit the query text and submit to reload. The same query is shared with the phylogenetic tree.",
      placement: "side",
    },
    {
      target: "table-goto-tree",
      title: "Open the tree",
      body: "Jump to the phylogenetic tree for the same query (and compare set).",
      placement: "side",
    },
    {
      target: "table-count-mode",
      title: "Count mode",
      body: "Choose how list numbers are counted: unique chemicals/species, articles, or all rows. When an item is selected, counts lock to articles.",
      placement: "side",
    },
    {
      target: "table-compare",
      title: "Compare queries",
      body: "Add up to 4 queries. Each gets a color; counts and dots show which query contributed. Zeros are hidden.",
      placement: "side",
    },
    {
      target: "table-download",
      title: "Download Excel",
      body: "Export an .xlsx workbook: an About sheet plus one sheet per compare query.",
      placement: "side",
    },
    {
      target: "table-chemical-panel",
      title: "Chemicals panel",
      body: "Hover a chemical to highlight related species and publications. Click to open details; use × to return to the list.",
      placement: "side",
    },
    {
      target: "table-species-panel",
      title: "Species panel",
      body: "Same interaction for species. Selecting a species or chemical drives the middle column.",
      placement: "side",
    },
    {
      target: "table-results",
      title: "Publications (References)",
      body: "This list appears only when a chemical or species is selected (or hovered). Empty “Select species or chemical” means nothing is focused yet. Colored dots mark compare queries; open citations from the reference controls.",
      prepare: "table-select",
      placement: "side",
    },
    {
      target: "table-detail-info",
      title: "Attribute info (ⓘ)",
      body: "On a selected chemical or species, each attribute can show an info icon — hover it for the field description.",
      prepare: "table-select",
      placement: "side",
    },
  ],
  tree: [
    {
      title: "Phylogenetic tree",
      body: "Browse taxonomy for your query. Pan and zoom the canvas, collapse busy clades, and jump back to the table anytime.",
    },
    {
      target: "tree-query",
      title: "Query bar",
      body: "Same query editor as on the table. Changing it reloads tree counts.",
      placement: "side",
    },
    {
      target: "tree-goto-table",
      title: "Back to the table",
      body: "Open the results table with the same query and compare set.",
      placement: "side",
    },
    {
      target: "tree-taxonomy",
      title: "Classification",
      body: "Switch taxonomy sources/tags. Collapsed clades are kept when possible if the same name still exists.",
      placement: "side",
    },
    {
      target: "tree-count-mode",
      title: "Count by",
      body: "Show chemicals, articles, or all records on each node.",
      placement: "side",
    },
    {
      target: "tree-depth",
      title: "Show ranks (from / to)",
      body: "Fold shallow ranks into a path stem and hide deep ranks. If “to” is unset, the tree auto-trims to maintain visual balance.",
      placement: "side",
    },
    {
      target: "tree-compare",
      title: "Compare on the tree",
      body: "With several queries, each node shows colored counts.",
      placement: "side",
    },
    {
      target: "tree-viewport",
      title: "Pan & zoom",
      body: "Drag to pan, scroll or pinch to zoom the tree canvas.",
      placement: "side",
    },
    {
      target: "tree-subtree-toggle",
      title: "Collapse subtree",
      body: "The small +/× on a branch collapses or expands that clade.",
      placement: "side",
    },
    {
      target: "tree-subtree-link",
      title: "Open subtree",
      body: "The dashed count chip opens a filtered subtree for that clade.",
      placement: "side",
    },
    {
      title: "Find in tree (Ctrl/Cmd+F)",
      body: "Press Ctrl+F (⌘F on Mac) for the find bar. Use Aa (case), Ab (whole word), and .* (regex). ↑/↓ cycle matches and expand ancestors when needed.",
      placement: "center",
    },
  ],
  history: [
    {
      title: "Query history",
      body: "Reopen past search and compare groups saved in this browser after successful fetches.",
      placement: "center",
    },
    {
      target: "history-list",
      title: "Saved groups",
      body: "Each card is one compare group with the fetch time.",
      placement: "side",
    },
    {
      target: "history-open",
      title: "Open again",
      body: "Use Tree or Table to reopen that exact query set.",
      placement: "side",
    },
    {
      target: "history-clear",
      title: "Clear history",
      body: "Removes all saved groups here. Kept ~1½ years in browser — it does not sync to another browser or device.",
      placement: "side",
    },
  ],
  cache: [
    {
      title: "API cache",
      body: "Successful API responses are cached locally to speed up reloads.",
      placement: "center",
    },
    {
      target: "cache-table",
      title: "Cached entries",
      body: "See kind, key, when it was stored, and when it expires.",
      placement: "side",
    },
    {
      target: "cache-toolbar",
      title: "Refresh & clear",
      body: "Refresh reloads the list. Clear all wipes the API cache. Use \"Clear all\" if you think the cache is outdated or broken. Does not clear query history.",
      placement: "side",
    },
  ],
  admin: [
    {
      title: "Admin console",
      body: "Manage data tables and BibTeX. Only signed-in admins see this page and the Admin nav icon.",
    },
    {
      target: "admin-topbar",
      title: "Table actions",
      body: "Update BibTeX and remove broken tables here. Logout is in the page header.",
      placement: "side",
    },
    {
      target: "admin-create",
      title: "Create a table",
      body: "Upload a sheet and metadata to create a new database version.",
      placement: "side",
    },
    {
      target: "admin-tables",
      title: "Table list",
      body: "Activate the table users search against, or delete unused versions.",
      placement: "side",
    },
  ],
};
