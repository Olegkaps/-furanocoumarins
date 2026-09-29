import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom", esbuild: { jsx: "automatic" },
  plugins: [{ name: "result-list-hooks", enforce: "pre",
    transform(code, id) {
      if (id.endsWith("/SearchApp/ResultTable.tsx")) return code.replaceAll('from "react"', 'from "virtual:result-list-hooks"') + "\nexport { SidePanel };";
    },
    resolveId(id) { if (id === "virtual:result-list-hooks") return "\0result-list-hooks"; },
    load(id) {
      if (id === "\0result-list-hooks") return `
        export const useState = (...args) => globalThis.__resultListHooks.useState(...args);
        export const useMemo = fn => fn();
        export const useCallback = fn => fn;
        export const useEffect = () => {};
        export const useRef = value => globalThis.__resultListHooks.useRef(value);`;
    },
  }],
});
after(() => { delete globalThis.__resultListHooks; return server.close(); });
const { RankedSelectList, SidePanel } = await server.ssrLoadModule("/src/SearchApp/ResultTable.tsx");

const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node)
  ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
function list(props, Component = RankedSelectList) {
  const cells = []; let cursor = 0, tree;
  const render = () => {
    cursor = 0;
    globalThis.__resultListHooks = {
      useState(initial) {
        const at = cursor++;
        cells[at] ??= { value: initial };
        return [cells[at].value, next => { cells[at].value = typeof next === "function" ? next(cells[at].value) : next; }];
      },
      useRef(initial) {
        const at = cursor++;
        cells[at] ??= { current: initial };
        return cells[at];
      },
    };
    tree = Component(props);
  };
  render();
  return {
    render,
    get nodes() { return nodes(tree); },
    get items() { return nodes(tree).filter(node => node.props?.className === "ranked-select-list__item"); },
    get labels() { return nodes(tree).filter(node => node.props?.className === "ranked-select-list__value").map(node => node.props.children); },
    click(label) { nodes(tree).find(node => node.props?.["aria-label"] === label).props.onClick(); render(); },
    filter(value) {
      if (!nodes(tree).some(node => node.type === "input")) {
        nodes(tree).find(node => node.type === "button" && node.props?.["aria-haspopup"] === "dialog").props.onClick(); render();
      }
      nodes(tree).find(node => node.type === "input").props.onChange({ target: { value } }); render();
    },
  };
}

test("name and count arrows choose explicit order without changing identities, compare counts or cached options", () => {
  const options = Object.freeze([
    Object.freeze({ value: "a-id", label: "Zebra", count: 9, seriesCounts: [{ color: "red", n: 1 }, { color: "blue", n: 8 }] }),
    Object.freeze({ value: "z-id", label: "Alpha", count: 4 }),
    Object.freeze({ value: "b-id", label: "Zebra", count: 9 }),
  ]);
  const hovered = [], selected = [];
  const view = list({ options, countModeLabel: "articles", onSelect: value => selected.push(value), onHover: value => hovered.push(value) });
  assert.deepEqual(view.labels, ["Zebra", "Zebra", "Alpha"]);
  const sortButton = by => view.nodes.find(node => node.type === "button" && node.props?.["aria-label"]?.startsWith(`Sort by ${by}:`));
  assert.equal(sortButton("count").props["aria-pressed"], true);
  sortButton("count").props.onClick(); view.render();
  assert.deepEqual(view.labels, ["Zebra", "Alpha", "Zebra"], "clearing the default count sort restores input order");
  sortButton("name").props.onClick(); view.render();
  assert.deepEqual(view.labels, ["Alpha", "Zebra", "Zebra"]);
  assert.equal(sortButton("name").props["aria-pressed"], true);
  view.items[0].props.onClick();
  assert.deepEqual(selected, ["z-id"]);
  sortButton("name").props.onClick(); view.render();
  assert.deepEqual(view.labels, ["Zebra", "Zebra", "Alpha"]);
  sortButton("count").props.onClick(); view.render();
  assert.deepEqual(view.labels, ["Alpha", "Zebra", "Zebra"], "switching sort columns starts ascending");
  sortButton("count").props.onClick(); view.render();
  assert.deepEqual(view.labels, ["Zebra", "Zebra", "Alpha"]);
  sortButton("count").props.onClick(); view.render();
  assert.deepEqual(view.labels, ["Zebra", "Alpha", "Zebra"], "the third click clears sorting");
  assert.deepEqual(hovered, [null, null, null, null, null, null]);
  assert.deepEqual(options.map(option => option.value), ["a-id", "z-id", "b-id"]);
  assert.deepEqual(view.nodes.filter(node => node.props?.className === "ranked-select-list__series-n").map(node => node.props.children), [1, 8]);
});

test("filter uses shown names, trims and folds case, and combines sorting before pagination", () => {
  const options = Array.from({ length: 205 }, (_, i) => ({ value: `hidden-${i}`, label: `${i === 204 ? "Angelica dahurica" : "Ruta"} ${String(i).padStart(3, "0")}`, count: i }));
  const hovered = [];
  const view = list({ options, countModeLabel: "species", entityLabel: "species", onSelect() {}, onHover: value => hovered.push(value) });
  assert.equal(view.labels.length, 100);
  view.click("Next page");
  view.nodes.find(node => node.type === "button" && node.props?.["aria-label"]?.startsWith("Sort by name:")).props.onClick(); view.render();
  assert.equal(view.labels[0], "Angelica dahurica 204", "sorting the full list resets to the first page");
  assert.ok(view.nodes.findIndex(node => node.type === "nav") < view.nodes.findIndex(node => node.props?.className === "ranked-select-list__controls"), "pagination precedes the column controls");
  assert.equal(view.nodes.find(node => node.props?.["aria-label"] === "Previous page").props.disabled, true);
  view.click("Next page");
  view.filter("  ANGELICA DAHURICA  ");
  assert.deepEqual(view.labels, ["Angelica dahurica 204"]);
  assert.equal(view.nodes.some(node => node.props?.["aria-label"] === "Next page"), false);
  assert.equal(view.nodes.find(node => node.type === "input").props["aria-label"], "Filter species names");
  view.filter("hidden-204");
  assert.deepEqual(view.labels, []);
  assert.ok(view.nodes.some(node => node.props?.children === "No matching names"));
  view.filter(" ruta ");
  assert.equal(view.labels.length, 100);
  assert.equal(view.labels[0], "Ruta 000");
  view.click("Next page");
  assert.equal(view.labels[0], "Ruta 100");
  assert.equal(view.labels.length, 100);
  view.click("Next page");
  assert.deepEqual(view.labels, ["Ruta 200", "Ruta 201", "Ruta 202", "Ruta 203"]);
  view.nodes.find(node => node.type === "button" && node.props?.["aria-label"]?.startsWith("Sort by name:")).props.onClick(); view.render();
  assert.equal(view.labels[0], "Ruta 203");
  view.filter("   ");
  assert.equal(view.labels[0], "Ruta 203");
  view.nodes.find(node => node.type === "button" && node.props?.["aria-label"]?.startsWith("Sort by count:")).props.onClick(); view.render();
  assert.equal(view.labels[0], "Ruta 000", "switching to count starts ascending");
  view.nodes.find(node => node.type === "button" && node.props?.["aria-label"]?.startsWith("Sort by count:")).props.onClick(); view.render();
  assert.equal(view.labels[0], "Angelica dahurica 204");
  assert.ok(hovered.every(value => value === null));
});

test("controlled list preferences survive selection and list remount", () => {
  const options = [{ value: "chemical-1", label: "Bergapten", count: 2 }, { value: "chemical-2", label: "Neobyakangelicol", count: 8 }];
  const props = { kind: "chemical", title: "Chemical", listCount: 2, options, countModeLabel: "Count",
    selected: "", onSelect(value) { props.selected = value; }, onClear() { props.selected = ""; }, detailRow: null, meta: [] };
  const panel = list(props, SidePanel);
  const first = list(panel.nodes.find(node => node.type === RankedSelectList).props);
  first.nodes.find(node => node.type === "button" && node.props?.["aria-label"]?.startsWith("Sort by name:")).props.onClick(); first.render();
  panel.render();
  // The mounted list receives the updated state owned by its side panel.
  const filtered = list(panel.nodes.find(node => node.type === RankedSelectList).props);
  filtered.filter("berg");
  panel.render();
  filtered.items[0].props.onClick();
  panel.render();
  assert.equal(panel.nodes.some(node => node.type === RankedSelectList), false);
  panel.click("Back to list");
  const returnedProps = panel.nodes.find(node => node.type === RankedSelectList).props;
  const returned = list(returnedProps);
  assert.deepEqual(returned.labels, ["Bergapten"]);
  assert.equal(returned.nodes.some(node => node.type === "input"), false);
  returned.click("Filter chemical names");
  assert.equal(returned.nodes.find(node => node.type === "input").props.value, "berg");
  assert.equal(returned.nodes.find(node => node.type === "button" && node.props?.["aria-label"]?.startsWith("Sort by name:")).props["aria-pressed"], true);
  returned.filter("");
  panel.render();
  assert.deepEqual(list(panel.nodes.find(node => node.type === RankedSelectList).props).labels, ["Bergapten", "Neobyakangelicol"]);
});

test("filter opens on demand, closes with Escape and clear, and restores trigger focus", () => {
  const view = list({ options: [{ value: "a", label: "Alpha", count: 1 }, { value: "b", label: "Beta", count: 2 }], countModeLabel: "articles", entityLabel: "chemical", onSelect() {} });
  const trigger = () => view.nodes.find(node => node.type === "button" && node.props?.["aria-haspopup"] === "dialog");
  let focused = 0;
  trigger().props.ref.current = { focus() { focused++; } };
  assert.equal(view.nodes.some(node => node.type === "input"), false);
  view.click("Filter chemical names");
  assert.equal(trigger().props["aria-expanded"], true);
  assert.equal(view.nodes.find(node => node.type === "input").props.autoFocus, true);
  view.filter("alpha");
  assert.equal(trigger().props.className, "ranked-select-list__filter-active");
  let prevented = false;
  view.nodes.find(node => node.props?.className === "ranked-select-list__controls").props.onKeyDown({ key: "Escape", preventDefault() { prevented = true; } });
  view.render();
  assert.equal(prevented, true);
  assert.equal(focused, 1);
  assert.equal(trigger().props["aria-expanded"], false);
  assert.deepEqual(view.labels, ["Alpha"]);
  view.click("Filter chemical names");
  view.nodes.find(node => node.type === "button" && node.props?.children === "Clear").props.onClick();
  view.render();
  assert.deepEqual(view.labels, ["Beta", "Alpha"]);
  assert.equal(trigger().props.className, undefined);
  assert.equal(trigger().props["aria-expanded"], false);
  assert.equal(focused, 2);
  view.click("Filter chemical names");
  view.nodes.find(node => node.type === "button" && node.props?.children === "Close").props.onClick();
  view.render();
  assert.equal(trigger().props["aria-expanded"], false);
  assert.equal(focused, 3);
  view.click("Filter chemical names");
  const blur = () => view.nodes.find(node => node.props?.className === "ranked-select-list__controls").props.onBlur;
  blur()({ currentTarget: { contains: () => true }, relatedTarget: {} });
  view.render();
  assert.equal(trigger().props["aria-expanded"], true, "moving focus within filter controls keeps the overlay open");
  blur()({ currentTarget: { contains: () => false }, relatedTarget: {} });
  view.render();
  assert.equal(trigger().props["aria-expanded"], false, "moving focus to list rows dismisses the overlay");
});
