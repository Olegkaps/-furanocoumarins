import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { isEmpty } from "../shared/api";
import { ZoomableContainer } from "../shared/ui";
import config from "../config";
import { ArrowUpRightFromSquare } from "@gravity-ui/icons";
import { InfoTip } from "../shared/ui/InfoTip";

class Specie {
  values_count: number;
  clades: Array<string>;

  constructor(count: number, clades: Array<string>) {
    this.values_count = count;
    this.clades = clades;
  }
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
  ) {
    const rawLabel = displayName ?? this.clade_name;
    const segmentCount = countCollapsedSegments(rawLabel);
    const isCollapsedPath = segmentCount > 1 || this.is_path_stem;
    // Collapsed paths keep spaces as nbsp so segments stay on one line while truncating.
    // Plain labels keep real spaces so long names can wrap.
    const label = isCollapsedPath
      ? rawLabel.replace(/ /g, "\u00A0")
      : rawLabel;
    const branchWidth = estimateBranchWidth(segmentCount);
    const childNames = Object.keys(this.childs).sort((a, b) => {
      const ca = this.childs[a].childs_num;
      const cb = this.childs[b].childs_num;
      return cb - ca || a.localeCompare(b);
    });

    const childCount = Object.keys(this.childs).length;
    const wouldHideCount =
      (childCount <= 1 && total_bros === 1) ||
      (meta_ind === 1 && total_bros === 1);
    // Exception: empty rank then a named clade of unary length 1 (e.g. after
    // truncating display so "" / X becomes a leaf) — still show the link on X.
    const showCount =
      !wouldHideCount ||
      (this.after_empty_rank && this.clade_name.replaceAll(" ", "") !== "");

    const fullTitle = displayName
      ? displayName.replace(/\u00A0/g, " ")
      : meta_names[meta_ind] || rawLabel;

    return (
      <div
        style={{
          width: "100%",
          backgroundColor: "var(--color-surface)",
          display: "table",
        }}
      >
        <div
          className="tree-branch-cell"
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
          <TreeCladesAdapter
            drawLeftBorder={meta_ind === 0 || child_ind === total_bros - 1}
          />
        </div>
        <div style={{ display: "table-cell", verticalAlign: "middle" }}>
          {isEmpty(this.childs) || !this.is_visible ? (
            <div></div>
          ) : (
            <div>
              {childNames.map((name, ind) => (
                <div key={name}>
                  {this.childs[name].render(
                    meta,
                    meta_names,
                    meta_ind + 1,
                    ind,
                    childNames.length,
                  )}
                </div>
              ))}
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

function isBlankClade(name: string): boolean {
  return name.replaceAll(" ", "") === "";
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
    prefix: string[],
    dParent: PhilogeneticTreeNode,
  ) => {
    if (depth < fromLevel) {
      Object.values(orig.childs).forEach((child) => {
        walk(child, depth + 1, [...prefix, child.clade_name], dParent);
      });
      return;
    }

    if (depth > toLevel) {
      return;
    }

    let attach = dParent;
    if (depth === fromLevel && prefix.length > 0) {
      const stemName = prefix
        .filter((p) => !isBlankClade(p))
        .join(" / ");
      if (stemName) {
        const stem = ensureChild(dParent, stemName);
        stem.is_path_stem = true;
        stem.childs_num = Math.max(stem.childs_num, orig.childs_num);
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
        walk(child, depth + 1, [], dNode);
      });
    }
  };

  Object.values(sourceRoot.childs).forEach((child) => {
    walk(child, 0, [], displayRoot);
  });
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
  if (species.length === 0) {
    return <div></div>;
  }
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
  const { pathLabels, tip, metaOffset } = collapseUnaryFromRoot(projected);
  const collapsedLabel = pathLabels.join(" / ");

  return (
    <ZoomableContainer>
      {pathLabels.length > 0 ? (
        tip.render(meta, meta_names, metaOffset, 0, 1, collapsedLabel)
      ) : (
        projected.render(meta, meta_names)
      )}
    </ZoomableContainer>
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
