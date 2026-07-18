import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isEmpty } from "../shared/api";
import { ZoomableContainer, type ZoomableHandle } from "../shared/ui";
import config from "../config";
import {
  ArrowUpRightFromSquare,
  ChevronDown,
  ChevronRight,
  FontCase,
  Magnifier,
  Xmark,
} from "@gravity-ui/icons";
import { InfoTip } from "../shared/ui/InfoTip";

class Specie {
  values_count: number;
  clades: Array<string>;

  constructor(count: number, clades: Array<string>) {
    this.values_count = count;
    this.clades = clades;
  }
}

const PATH_SEP = "›";

type TreeViewCtx = {
  collapsedIds: Set<string>;
  toggleCollapsed: (id: string) => void;
  matchIds: Set<string>;
  activeMatchId: string | null;
};

function isBlankClade(name: string): boolean {
  return name.replaceAll(" ", "") === "";
}

class PhilogeneticTreeNode {
  clade_name: string;
  childs: { [key: string]: PhilogeneticTreeNode };
  childs_num: number;
  clades_num: number;
  is_visible: boolean;
  /** Column key for count-link query (optional for synthetic stems). */
  link_key: string;
  link_val: string;
  is_path_stem: boolean;
  /** Named clade immediately after an empty rank — keep count/link when unary/leaf. */
  after_empty_rank: boolean;

  constructor(clade_name: string) {
    this.clade_name = clade_name;
    this.childs = {};
    this.childs_num = 0;
    this.clades_num = 0;
    this.is_visible = true;
    this.link_key = "";
    this.link_val = clade_name;
    this.is_path_stem = false;
    this.after_empty_rank = false;
  }

  add_child(
    clades: Array<string>,
    count: number,
    aggregateChildCounts: boolean,
  ) {
    const curr_clade = clades[0];
    if (!(curr_clade in this.childs)) {
      this.childs[curr_clade] = new PhilogeneticTreeNode(curr_clade);
    }
    this.clades_num += 1;
    if (aggregateChildCounts) {
      this.childs_num += count;
    }

    if (clades.length > 1) {
      this.childs[curr_clade].add_child(
        clades.slice(1),
        count,
        aggregateChildCounts,
      );
    } else {
      this.childs[curr_clade].clades_num = 1;
      this.childs[curr_clade].childs_num = count;
    }
  }

  render(
    meta: Array<string>,
    meta_names: Array<string>,
    meta_ind: number = 0,
    child_ind: number = 0,
    total_bros: number = 0,
    displayName?: string,
    ctx?: TreeViewCtx,
    nodePath: string = "",
  ) {
    const rawLabel = displayName ?? this.clade_name;
    const segmentCount = countCollapsedSegments(rawLabel);
    const isCollapsedPath = segmentCount > 1 || this.is_path_stem;
    const label = isCollapsedPath
      ? rawLabel.replace(/ /g, "\u00A0")
      : rawLabel;
    const branchWidth = estimateBranchWidth(segmentCount);
    const childNames = Object.keys(this.childs).sort((a, b) => {
      const ca = this.childs[a].childs_num;
      const cb = this.childs[b].childs_num;
      return cb - ca || a.localeCompare(b);
    });

    const pathId =
      nodePath ||
      (isBlankClade(this.clade_name) ? "__root__" : this.clade_name);
    const childCount = childNames.length;
    const subtreeHidden = ctx?.collapsedIds.has(pathId) ?? false;
    const canToggleSubtree = childCount > 1;

    const wouldHideCount =
      (childCount <= 1 && total_bros === 1) ||
      (meta_ind === 1 && total_bros === 1);
    const showCount =
      !wouldHideCount ||
      (this.after_empty_rank && this.clade_name.replaceAll(" ", "") !== "");

    const fullTitle = displayName
      ? displayName.replace(/\u00A0/g, " ")
      : meta_names[meta_ind] || rawLabel;

    const searchText = fullTitle.replace(/\u00A0/g, " ").trim();
    const isMatch = ctx?.matchIds.has(pathId) ?? false;
    const isActiveMatch = ctx?.activeMatchId === pathId;

    return (
      <div
        style={{
          width: "100%",
          backgroundColor: "var(--color-surface)",
          display: "table",
        }}
      >
        <div
          className={
            "tree-branch-cell" +
            (isMatch ? " is-search-match" : "") +
            (isActiveMatch ? " is-search-active" : "")
          }
          data-tree-node-id={pathId}
          data-tree-search-text={searchText}
          style={{
            display: "table-cell",
            verticalAlign: "middle",
            height: Math.max(30, 30 * this.clades_num),
            borderColor: "white",
            width: branchWidth,
            minWidth: branchWidth,
            maxWidth: branchWidth,
          }}
        >
          <TreeCladesAdapter
            drawLeftBorder={meta_ind === 0 || child_ind === 0}
          />
          <TreeCladeLine />
          <div
            className={
              isCollapsedPath
                ? "tree-branch-label-wrap is-collapsed"
                : "tree-branch-label-wrap is-plain"
            }
          >
            <p
              className={
                isCollapsedPath
                  ? "tree-branch-label is-collapsed"
                  : "tree-branch-label is-plain"
              }
              style={{
                fontSize: config["FONT_SIZE"],
                maxWidth: Math.max(80, branchWidth - 48),
              }}
              title={fullTitle}
            >
              {isCollapsedPath ? (
                <span className="tree-branch-label__text">{label}</span>
              ) : (
                label
              )}
            </p>
          </div>
          <div className="tree-branch-actions">
            {canToggleSubtree && ctx && (
              <button
                type="button"
                className="tree-subtree-toggle"
                title={subtreeHidden ? "Expand subtree" : "Collapse subtree"}
                aria-label={subtreeHidden ? "Expand subtree" : "Collapse subtree"}
                onClick={(e) => {
                  e.stopPropagation();
                  ctx.toggleCollapsed(pathId);
                }}
              >
                {subtreeHidden ? (
                  <ChevronRight width={14} height={14} />
                ) : (
                  <ChevronDown width={14} height={14} />
                )}
              </button>
            )}
            {showCount && (
              <div className="tree-branch-count">
                <CountButton
                  number={this.childs_num}
                  clade_key={this.link_key || meta[meta_ind] || ""}
                  clade_val={this.link_val || this.clade_name}
                  plain={this.is_path_stem}
                />
              </div>
            )}
          </div>
          <TreeCladesAdapter
            drawLeftBorder={meta_ind === 0 || child_ind === total_bros - 1}
          />
        </div>
        <div style={{ display: "table-cell", verticalAlign: "middle" }}>
          {isEmpty(this.childs) || !this.is_visible || subtreeHidden ? (
            <div>
              {subtreeHidden && canToggleSubtree && (
                <span className="tree-subtree-hidden-hint">
                  {childCount} branches hidden
                </span>
              )}
            </div>
          ) : (
            <div>
              {childNames.map((name, ind) => {
                const childPath = `${pathId}${PATH_SEP}${name}`;
                return (
                  <div key={name}>
                    {this.childs[name].render(
                      meta,
                      meta_names,
                      meta_ind + 1,
                      ind,
                      childNames.length,
                      undefined,
                      ctx,
                      childPath,
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }
}

function countCollapsedSegments(label: string): number {
  const parts = label
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return Math.max(1, parts.length);
}

/** Width from how many clades are folded into the label, not from string length. */
function estimateBranchWidth(segmentCount: number): number {
  const n = Math.max(1, segmentCount);
  // Plain names wrap in-column; collapsed paths need room for multi-segment ellipsis.
  if (n === 1) return 180;
  return Math.max(200, Math.min(640, 160 + (n - 1) * 52));
}

function recomputeCladesNum(node: PhilogeneticTreeNode): number {
  const names = Object.keys(node.childs);
  if (names.length === 0) {
    node.clades_num = 1;
    return 1;
  }
  let sum = 0;
  names.forEach((name) => {
    sum += recomputeCladesNum(node.childs[name]);
  });
  node.clades_num = sum;
  return sum;
}

function ensureChild(
  parent: PhilogeneticTreeNode,
  name: string,
): PhilogeneticTreeNode {
  if (!(name in parent.childs)) {
    parent.childs[name] = new PhilogeneticTreeNode(name);
  }
  return parent.childs[name];
}

/**
 * Build a display-only tree: levels before `fromLevel` become a path stem,
 * levels after `toLevel` are omitted. Counts are copied from the source tree.
 */
function projectTreeForDisplay(
  sourceRoot: PhilogeneticTreeNode,
  meta: string[],
  fromLevel: number,
  toLevel: number,
): PhilogeneticTreeNode {
  const displayRoot = new PhilogeneticTreeNode("");

  const walk = (
    orig: PhilogeneticTreeNode,
    depth: number,
    /** Ancestor names only (not including `orig`). */
    prefix: string[],
    dParent: PhilogeneticTreeNode,
    sourceParent: PhilogeneticTreeNode,
  ) => {
    if (depth < fromLevel) {
      Object.values(orig.childs).forEach((child) => {
        walk(
          child,
          depth + 1,
          isBlankClade(orig.clade_name)
            ? prefix
            : [...prefix, orig.clade_name],
          dParent,
          orig,
        );
      });
      return;
    }

    if (depth > toLevel) {
      return;
    }

    let attach = dParent;
    if (depth === fromLevel && prefix.length > 0) {
      const stemName = prefix.filter((p) => !isBlankClade(p)).join(" / ");
      if (stemName) {
        const stem = ensureChild(dParent, stemName);
        stem.is_path_stem = true;
        // Stem represents the folded ancestors — use the parent's count.
        stem.childs_num = Math.max(stem.childs_num, sourceParent.childs_num);
        stem.link_key = "";
        stem.link_val = stemName;
        attach = stem;
      }
    }

    const dNode = ensureChild(attach, orig.clade_name);
    dNode.childs_num = orig.childs_num;
    dNode.link_key = meta[depth + 1] ?? "";
    dNode.link_val = orig.clade_name;
    dNode.is_path_stem = false;
    if (
      !isBlankClade(orig.clade_name) &&
      isBlankClade(attach.clade_name) &&
      !attach.is_path_stem
    ) {
      dNode.after_empty_rank = true;
    }

    if (depth < toLevel) {
      Object.values(orig.childs).forEach((child) => {
        walk(child, depth + 1, [], dNode, orig);
      });
    }
  };

  Object.values(sourceRoot.childs).forEach((child) => {
    walk(child, 0, [], displayRoot, sourceRoot);
  });
  displayRoot.childs_num = sourceRoot.childs_num;
  recomputeCladesNum(displayRoot);
  return displayRoot;
}

/** Collapse unary chains from the root into a folder-style path label. */
function collapseUnaryFromRoot(root: PhilogeneticTreeNode): {
  pathLabels: string[];
  tip: PhilogeneticTreeNode;
  metaOffset: number;
} {
  const pathLabels: string[] = [];
  let tip = root;
  let metaOffset = 0;
  let sawEmpty = false;

  while (Object.keys(tip.childs).length === 1) {
    const name = Object.keys(tip.childs)[0];
    tip = tip.childs[name];
    if (isBlankClade(name)) {
      sawEmpty = true;
    } else {
      pathLabels.push(name);
      if (sawEmpty) {
        tip.after_empty_rank = true;
        sawEmpty = false;
      }
    }
    metaOffset += 1;
  }

  return { pathLabels, tip, metaOffset };
}

function TreeCladesAdapter({ drawLeftBorder }: { drawLeftBorder: boolean }) {
  return (
    <div
      style={
        drawLeftBorder
          ? { height: "50%" }
          : { height: "50%", borderLeft: "2px solid var(--color-ink)" }
      }
    >
      &nbsp;
    </div>
  );
}

function TreeCladeLine() {
  return (
    <hr
      style={{
        borderColor: "var(--color-ink)",
        width: "100%",
        margin: 0,
      }}
    ></hr>
  );
}

function CountButton({
  number,
  clade_key,
  clade_val,
  plain,
}: {
  number: number;
  clade_key: string;
  clade_val: string;
  plain?: boolean;
}) {
  const [searchParams] = useSearchParams();

  const showLink =
    !plain &&
    clade_key !== "__root__" &&
    clade_key !== "" &&
    clade_val.replaceAll(" ", "") !== "";

  const inner = (
    <>
      <span className="tree-count-chip__num">{number}</span>
      {showLink && (
        <ArrowUpRightFromSquare
          style={{ width: 12, height: 12, flexShrink: 0 }}
          aria-hidden
        />
      )}
    </>
  );

  if (!showLink) {
    return <span className="tree-count-chip">{inner}</span>;
  }

  const next = new URLSearchParams(searchParams);
  let query = next.get("query") ?? "";
  const clause = `${clade_key} = '${clade_val}'`;
  if (!query.includes(clause) && !query.includes(`${clade_key} =`)) {
    query = query.trim() === "" ? clause : `${query} AND ${clause}`;
  }
  next.set("query", query);

  return (
    <Link
      className="tree-count-chip tree-count-chip--link"
      to={{
        pathname: "/tree",
        search: next.toString(),
      }}
      title="Open subtree"
      style={{ fontSize: config["FONT_SIZE"] }}
    >
      {inner}
    </Link>
  );
}

export type CountMode = "chemicals" | "articles" | "all";

function parseCountMode(raw: string | null): CountMode {
  if (raw === "chemicals" || raw === "articles" || raw === "all") {
    return raw;
  }
  return "all";
}

function parseOptionalInt(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function joinedCladeMatchesPrefix(fullKey: string, prefix: string): boolean {
  if (prefix === "") {
    return true;
  }
  return fullKey === prefix || fullKey.startsWith(prefix + "@");
}

type UniquesByClades = {
  [joined_clades: string]: {
    smiles: Set<string>;
    refs: Set<string>;
    total: number;
  };
};

function assignUniqueCountsToTree(
  node: PhilogeneticTreeNode,
  pathParts: Array<string>,
  uniquesByClades: UniquesByClades,
  smilesColumns: Array<string>,
  refColumns: Array<string>,
  countMode: "chemicals" | "articles",
) {
  const prefix = pathParts.join("@");
  const mergedSmiles = new Set<string>();
  const mergedRefs = new Set<string>();
  Object.entries(uniquesByClades).forEach(([joined, u]) => {
    if (joinedCladeMatchesPrefix(joined, prefix)) {
      u.smiles.forEach((s) => mergedSmiles.add(s));
      u.refs.forEach((r) => mergedRefs.add(r));
    }
  });
  const nSmiles = smilesColumns.length ? mergedSmiles.size : 1;
  const nRefs = refColumns.length ? mergedRefs.size : 1;
  node.childs_num = countMode === "chemicals" ? nSmiles : nRefs;

  Object.values(node.childs).forEach((child) => {
    assignUniqueCountsToTree(
      child,
      [...pathParts, child.clade_name],
      uniquesByClades,
      smilesColumns,
      refColumns,
      countMode,
    );
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFindRegex(
  query: string,
  opts: { matchCase: boolean; regex: boolean; wholeWord: boolean },
): RegExp | null {
  if (query === "") return null;
  try {
    let source = opts.regex ? query : escapeRegExp(query);
    if (opts.wholeWord) {
      source = `(?<![\\w])(?:${source})(?![\\w])`;
    }
    return new RegExp(source, opts.matchCase ? "g" : "gi");
  } catch {
    return null;
  }
}

type SearchableNode = { id: string; text: string };

function collectSearchableNodes(
  node: PhilogeneticTreeNode,
  pathId: string,
  displayName: string | undefined,
  out: SearchableNode[],
) {
  const text = (displayName ?? node.clade_name).replace(/\u00A0/g, " ").trim();
  if (text !== "") {
    out.push({ id: pathId, text });
    // Also index path segments for collapsed labels
    text.split(/\s*\/\s*/).forEach((seg) => {
      const t = seg.trim();
      if (t && t !== text) out.push({ id: pathId, text: t });
    });
  }
  Object.keys(node.childs)
    .sort()
    .forEach((name) => {
      collectSearchableNodes(
        node.childs[name],
        `${pathId}${PATH_SEP}${name}`,
        undefined,
        out,
      );
    });
}

function ancestorIdsOf(pathId: string): string[] {
  const parts = pathId.split(PATH_SEP);
  const ids: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    ids.push(parts.slice(0, i).join(PATH_SEP));
  }
  return ids;
}

function TreeFindBar({
  open,
  onClose,
  query,
  setQuery,
  matchCase,
  setMatchCase,
  useRegex,
  setUseRegex,
  wholeWord,
  setWholeWord,
  matchIndex,
  matchCount,
  onNext,
  onPrev,
}: {
  open: boolean;
  onClose: () => void;
  query: string;
  setQuery: (q: string) => void;
  matchCase: boolean;
  setMatchCase: (v: boolean) => void;
  useRegex: boolean;
  setUseRegex: (v: boolean) => void;
  wholeWord: boolean;
  setWholeWord: (v: boolean) => void;
  matchIndex: number;
  matchCount: number;
  onNext: () => void;
  onPrev: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="tree-find-bar"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (e.shiftKey) onPrev();
          else onNext();
        }
      }}
    >
      <Magnifier width={16} height={16} aria-hidden />
      <input
        ref={inputRef}
        type="text"
        className="tree-find-bar__input"
        placeholder="Find clade"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Find clade"
      />
      <span className="tree-find-bar__count">
        {matchCount === 0 ? "No results" : `${matchIndex + 1} of ${matchCount}`}
      </span>
      <button
        type="button"
        className={`tree-find-bar__toggle${matchCase ? " is-active" : ""}`}
        title="Match Case"
        aria-pressed={matchCase}
        onClick={() => setMatchCase(!matchCase)}
      >
        <FontCase width={14} height={14} />
      </button>
      <button
        type="button"
        className={`tree-find-bar__toggle${wholeWord ? " is-active" : ""}`}
        title="Match Whole Word"
        aria-pressed={wholeWord}
        onClick={() => setWholeWord(!wholeWord)}
      >
        <span className="tree-find-bar__ab">Ab</span>
      </button>
      <button
        type="button"
        className={`tree-find-bar__toggle${useRegex ? " is-active" : ""}`}
        title="Use Regular Expression"
        aria-pressed={useRegex}
        onClick={() => setUseRegex(!useRegex)}
      >
        <span className="tree-find-bar__re">.*</span>
      </button>
      <button
        type="button"
        className="tree-find-bar__nav"
        title="Previous Match (⇧Enter)"
        onClick={onPrev}
      >
        ↑
      </button>
      <button
        type="button"
        className="tree-find-bar__nav"
        title="Next Match (Enter)"
        onClick={onNext}
      >
        ↓
      </button>
      <button
        type="button"
        className="tree-find-bar__close"
        title="Close (Esc)"
        onClick={onClose}
      >
        <Xmark width={14} height={14} />
      </button>
    </div>
  );
}

function PhilogeneticTree({
  species,
  meta,
  meta_names,
  countMode,
  uniquesByClades,
  smilesColumns,
  refColumns,
  displayFrom,
  displayTo,
}: {
  species: Array<Specie>;
  meta: Array<string>;
  meta_names: Array<string>;
  countMode: CountMode;
  uniquesByClades: UniquesByClades;
  smilesColumns: Array<string>;
  refColumns: Array<string>;
  displayFrom: number;
  displayTo: number;
}) {
  const zoomRef = useRef<ZoomableHandle>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);

  const treeModel = useMemo(() => {
    if (species.length === 0) return null;
    const aggregateChildCounts = countMode === "all";
    const root = new PhilogeneticTreeNode("");
    for (const specie of species) {
      root.add_child(specie.clades, specie.values_count, aggregateChildCounts);
    }
    if (countMode === "chemicals" || countMode === "articles") {
      assignUniqueCountsToTree(
        root,
        [],
        uniquesByClades,
        smilesColumns,
        refColumns,
        countMode,
      );
    }
    const maxLevel = Math.max(0, meta.length - 2);
    const from = Math.max(0, Math.min(displayFrom, maxLevel));
    const to = Math.max(from, Math.min(displayTo, maxLevel));
    const projected = projectTreeForDisplay(root, meta, from, to);
    const collapsed = collapseUnaryFromRoot(projected);
    return { projected, ...collapsed, from, to };
  }, [
    species,
    meta,
    countMode,
    uniquesByClades,
    smilesColumns,
    refColumns,
    displayFrom,
    displayTo,
  ]);

  useEffect(() => {
    setCollapsedIds(new Set());
  }, [displayFrom, displayTo, countMode]);

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const searchable = useMemo(() => {
    if (!treeModel) return [] as SearchableNode[];
    const out: SearchableNode[] = [];
    const { pathLabels, tip, projected } = treeModel;
    if (pathLabels.length > 0) {
      const tipId =
        pathLabels.filter((p) => !isBlankClade(p)).join(PATH_SEP) ||
        tip.clade_name;
      collectSearchableNodes(tip, tipId, pathLabels.join(" / "), out);
    } else {
      collectSearchableNodes(projected, "__root__", "", out);
    }
    return out;
  }, [treeModel]);

  const matchIdsList = useMemo(() => {
    const re = buildFindRegex(findQuery, {
      matchCase,
      regex: useRegex,
      wholeWord,
    });
    if (!re) return [] as string[];
    const seen = new Set<string>();
    const ids: string[] = [];
    searchable.forEach(({ id, text }) => {
      re.lastIndex = 0;
      if (re.test(text) && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    });
    return ids;
  }, [searchable, findQuery, matchCase, useRegex, wholeWord]);

  useEffect(() => {
    setMatchIndex(0);
  }, [findQuery, matchCase, useRegex, wholeWord, matchIdsList.length]);

  const activeMatchId =
    matchIdsList.length > 0
      ? matchIdsList[Math.min(matchIndex, matchIdsList.length - 1)]
      : null;

  const goMatch = useCallback(
    (dir: 1 | -1) => {
      if (matchIdsList.length === 0) return;
      setMatchIndex(
        (i) => (i + dir + matchIdsList.length) % matchIdsList.length,
      );
    },
    [matchIdsList.length],
  );

  // Expand ancestors and center on active match
  useEffect(() => {
    if (!activeMatchId) return;
    const ancestors = ancestorIdsOf(activeMatchId);
    setCollapsedIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      ancestors.forEach((id) => {
        if (next.has(id)) {
          next.delete(id);
          changed = true;
        }
      });
      // Also expand the match node itself if it was collapsed
      if (next.has(activeMatchId)) {
        next.delete(activeMatchId);
        changed = true;
      }
      return changed ? next : prev;
    });

    const t = window.setTimeout(() => {
      const el = document.querySelector(
        `[data-tree-node-id="${CSS.escape(activeMatchId)}"]`,
      ) as HTMLElement | null;
      if (el) zoomRef.current?.centerOnElement(el);
    }, 50);
    return () => window.clearTimeout(t);
  }, [activeMatchId, matchIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isFind = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f";
      if (isFind) {
        e.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!treeModel || species.length === 0) {
    return <div></div>;
  }

  const { pathLabels, tip, metaOffset, projected } = treeModel;
  const collapsedLabel = pathLabels.join(" / ");
  const tipId =
    pathLabels.filter((p) => !isBlankClade(p)).join(PATH_SEP) ||
    (isBlankClade(tip.clade_name) ? "__root__" : tip.clade_name);

  const ctx: TreeViewCtx = {
    collapsedIds,
    toggleCollapsed,
    matchIds: new Set(matchIdsList),
    activeMatchId,
  };

  return (
    <div className="tree-viewport-wrap">
      <TreeFindBar
        open={findOpen}
        onClose={() => setFindOpen(false)}
        query={findQuery}
        setQuery={setFindQuery}
        matchCase={matchCase}
        setMatchCase={setMatchCase}
        useRegex={useRegex}
        setUseRegex={setUseRegex}
        wholeWord={wholeWord}
        setWholeWord={setWholeWord}
        matchIndex={matchIndex}
        matchCount={matchIdsList.length}
        onNext={() => goMatch(1)}
        onPrev={() => goMatch(-1)}
      />
      <ZoomableContainer ref={zoomRef}>
        {pathLabels.length > 0
          ? tip.render(
              meta,
              meta_names,
              metaOffset,
              0,
              1,
              collapsedLabel,
              ctx,
              tipId,
            )
          : projected.render(
              meta,
              meta_names,
              0,
              0,
              0,
              undefined,
              ctx,
              "__root__",
            )}
      </ZoomableContainer>
    </div>
  );
}

const TAXONOMY_INFO =
  "Taxonomy according to NCBI is given starting with subtribes. Taxonomy of genus and species is given according to original articles, POWO site and Pimenov (the expert in Apiaceae taxonomy) opinion.";

const DEPTH_INFO =
  "Limits which taxonomic ranks are drawn. Levels before “from” are folded into one path stem; levels after “to” are hidden. Counts are unchanged.";

function PhilogeneticTreeOrNull({
  response,
}: {
  response: { [index: string]: any };
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  const tag = searchParams.get("tag") || "original";
  const countMode = parseCountMode(searchParams.get("count"));
  const displayFrom = parseOptionalInt(searchParams.get("from")) ?? 0;
  const displayTo = parseOptionalInt(searchParams.get("to"));

  const patchParams = (patch: Record<string, string | null>) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(patch).forEach(([key, value]) => {
          if (value == null || value === "") {
            next.delete(key);
          } else {
            next.set(key, value);
          }
        });
        return next;
      },
      { replace: true },
    );
  };

  if (isEmpty(response)) {
    return <div></div>;
  }

  const metadata_response = response["metadata"];
  metadata_response.sort(
    (a: { [x: string]: string }, b: { [x: string]: string }) => {
      let t_a = a["type"];
      if (t_a.startsWith("table_")) {
        t_a = t_a.split(" ")[1];
      }

      let t_b = b["type"];
      if (t_b.startsWith("table_")) {
        t_b = t_b.split(" ")[1];
      }

      if (t_a === t_b) {
        return 0;
      } else if (t_a < t_b) {
        return 1;
      }
      return -1;
    },
  );

  const species_meta = ["__root__"];
  const meta_names = ["__root__"];
  const class_num_to_tag: { [val: string]: string } = {};

  const all_tags = new Set<string>();
  all_tags.add("original");
  all_tags.add(tag);

  metadata_response.forEach((meta_item: { [index: string]: any }) => {
    const _type = meta_item["type"];
    if (!_type.includes("clas[")) {
      return;
    }

    const curr_num: string = _type.split("clas[")[1].split("]")[0];

    let curr_tag = "original";
    if (_type.includes("][")) {
      curr_tag = _type.split("][")[1].split("]")[0];
    }

    all_tags.add(curr_tag);
    if (curr_tag === "original" && !(curr_num in class_num_to_tag)) {
      //
    } else if (curr_tag === tag && curr_num in class_num_to_tag) {
      species_meta.pop();
      meta_names.pop();
    } else if (curr_tag !== tag) {
      return;
    }

    const clade_name = meta_item["column"];
    species_meta.push(clade_name);
    meta_names.push(meta_item["name"]);
    class_num_to_tag[curr_num] = curr_tag;
  });

  const cladeLevels = meta_names.slice(1).map((name, index) => ({
    index,
    name: name || species_meta[index + 1] || `Level ${index + 1}`,
  }));

  const maxLevel = Math.max(0, cladeLevels.length - 1);
  const effectiveFrom = Math.min(displayFrom, maxLevel);
  const effectiveTo =
    displayTo == null
      ? maxLevel
      : Math.max(effectiveFrom, Math.min(displayTo, maxLevel));

  const smilesColumns = (
    response["metadata"] as Array<{ [index: string]: string }>
  )
    .filter((m) => m["type"]?.includes("SMILES"))
    .map((m) => m["column"]);
  const refColumns = (
    response["metadata"] as Array<{ [index: string]: string }>
  )
    .filter((m) => m["type"]?.includes("ref[]"))
    .map((m) => m["column"]);

  const uniquesByClades: UniquesByClades = {};

  response["data"]?.forEach((row: { [index: string]: string }) => {
    const clades: Array<string> = [];
    species_meta.forEach((clade_name: string, ind: number) => {
      if (ind === 0) return;
      clades.push(row[clade_name]);
    });
    const joined_clades = clades.join("@");
    if (!(joined_clades in uniquesByClades)) {
      uniquesByClades[joined_clades] = {
        smiles: new Set(),
        refs: new Set(),
        total: 0,
      };
    }
    const u = uniquesByClades[joined_clades];
    u.total += 1;
    u.smiles.add(row[smilesColumns[0]]);
    u.refs.add(row[refColumns[0]]);
  });

  const counts: { [index: string]: number } = {};
  Object.entries(uniquesByClades).forEach(([joined_clades, u]) => {
    const nSmiles = u.smiles.size;
    const nRefs = u.refs.size;
    counts[joined_clades] =
      countMode === "chemicals"
        ? nSmiles
        : countMode === "articles"
          ? nRefs
          : u.total;
  });

  const species = [] as Array<Specie>;
  Object.entries(counts).forEach(([joined_clades, count]) => {
    species.push(new Specie(count, joined_clades.split("@")));
  });

  const treeToolbar = (
    <div className="panel tree-toolbar">
      <div className="tree-toolbar__group">
        <span className="tree-toolbar__label">
          Select classification
          <InfoTip text={TAXONOMY_INFO} label="About taxonomy sources" />
        </span>
        <div className="tree-toolbar__buttons">
          {Array(...all_tags)
            .sort()
            .map((item) => (
              <button
                key={item}
                type="button"
                className={`btn-toggle${item === tag ? " is-active" : ""}`}
                onClick={() => {
                  patchParams({
                    tag: item,
                    from: null,
                    to: null,
                  });
                }}
              >
                {item}
              </button>
            ))}
        </div>
      </div>

      <div className="tree-toolbar__divider" aria-hidden />

      <div className="tree-toolbar__group">
        <span className="tree-toolbar__label">Count by</span>
        <div className="tree-toolbar__buttons">
          {(["chemicals", "articles", "all"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`btn-toggle${mode === countMode ? " is-active" : ""}`}
              onClick={() => {
                patchParams({ count: mode === "all" ? null : mode });
              }}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="tree-toolbar__divider" aria-hidden />

      <div className="tree-toolbar__group">
        <span className="tree-toolbar__label">
          Show ranks
          <InfoTip text={DEPTH_INFO} label="About display depth" />
        </span>
        <div className="tree-toolbar__depth">
          <label>
            from
            <select
              value={effectiveFrom}
              onChange={(e) => {
                const v = Number(e.target.value);
                const nextTo =
                  displayTo == null ? null : Math.max(displayTo, v);
                patchParams({
                  from: v === 0 ? null : String(v),
                  to:
                    nextTo == null || nextTo >= maxLevel
                      ? null
                      : String(nextTo),
                });
              }}
            >
              {cladeLevels
                .filter((lvl) => lvl.index <= effectiveTo)
                .map((lvl) => (
                  <option key={lvl.index} value={lvl.index}>
                    {lvl.index + 1}. {lvl.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            to
            <select
              value={effectiveTo}
              onChange={(e) => {
                const v = Number(e.target.value);
                const nextFrom = Math.min(displayFrom, v);
                patchParams({
                  from: nextFrom === 0 ? null : String(nextFrom),
                  to: v >= maxLevel ? null : String(v),
                });
              }}
            >
              {cladeLevels
                .filter((lvl) => lvl.index >= effectiveFrom)
                .map((lvl) => (
                  <option key={lvl.index} value={lvl.index}>
                    {lvl.index + 1}. {lvl.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );

  if (species.length <= 1) {
    return (
      <div className="tree-page">
        {treeToolbar}
        <p className="empty-state">
          Phylogenetic tree is shown when the result contains at least two taxa.
          {species.length === 1
            ? " The current selection has only one species — open the result table or broaden the search."
            : " No taxa matched the current filters."}
        </p>
      </div>
    );
  }

  return (
    <div className="tree-page">
      {treeToolbar}
      <PhilogeneticTree
        species={species}
        meta={species_meta}
        meta_names={meta_names}
        countMode={countMode}
        uniquesByClades={uniquesByClades}
        smilesColumns={smilesColumns}
        refColumns={refColumns}
        displayFrom={effectiveFrom}
        displayTo={effectiveTo}
      />
    </div>
  );
}

export default PhilogeneticTreeOrNull;
