let config = {
    "FONT_SIZE": "1rem",
    "BASE_URL": import.meta.env.VITE_REACT_APP_BACKEND_SOURCE,
    "MAX_TABLES_COUNT": 15,
    /** Auto-pick tree “to” rank so drawn leaf clades stay at most this many (when URL has no `to`). */
    "TREE_MAX_VISIBLE_CLADES": 40,
    /** Vertical size of one leaf row in the phylogenetic tree (px). */
    "TREE_LEAF_ROW_PX": 34,
    /** Extra vertical gap between sibling subtrees (px); leaves in different branches get this separation. */
    "TREE_BRANCH_GAP_PX": 18,
    /** Max number of queries to compare at once (including the primary). */
    "MAX_COMPARE_QUERIES": 4,
    /**
     * 8 high-contrast colors for compare-query chips. Assigned randomly without
     * reuse inside the active set (see allocateCompareColor).
     */
    "COMPARE_QUERY_COLORS": [
        "#D97706",
        "#2563EB",
        "#16A34A",
        "#DC2626",
        "#0891B2",
        "#CA8A04",
        "#9A3412",
        "#1E3A8A",
    ],
    /** Client-side TTL for cached GET /search, /metadata, /article (ms). */
    "API_CACHE_TTL_MS": 30 * 60 * 1000,
}


export default config;
