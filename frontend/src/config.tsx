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
}


export default config;
