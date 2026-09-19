export function classificationColumn(columns, rank) {
  const matching = columns.filter((column) => new RegExp(`(?:^|\\s)clas\\[${rank}\\](?:\\s|$)`).test(column.type));
  return matching.find((column) => /(?:^|\s)tag\[(?:default|original)\](?:\s|$)/.test(column.type))?.column ?? matching[0]?.column;
}

function textValue(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(", ");
  if (value == null) return "";
  return String(value).trim();
}

export function recordTitle(kind, columns, item) {
  if (kind === "species") {
    const genus = textValue(item[classificationColumn(columns, 1) ?? ""]);
    const species = textValue(item[classificationColumn(columns, 0) ?? ""]);
    if (genus || species) return [genus, species].filter(Boolean).join(" ");
  }
  const preferred = columns.find((column) => /(?:^|\s)primary(?:\s|$)/.test(column.type))
    ?? columns.find((column) => /^(?:chemical_?name|name|names|title)$/i.test(column.column));
  return textValue(item[preferred?.column ?? ""]) || "Untitled record";
}

function pageStorageKey(kind, direction, cursor) {
  return `catalog-page:${kind}:${direction}:${encodeURIComponent(cursor)}`;
}

// Cursor values do not encode an ordinal. The first page is known from the
// URL; later pages are known only after this browser session followed a link.
export function catalogPageNumber(kind, cursor, before, storage) {
  if (!cursor && !before) return 1;
  const direction = cursor ? "cursor" : "before";
  const value = storage?.getItem(pageStorageKey(kind, direction, cursor || before));
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : null;
}

export function rememberCatalogPageNumber(kind, direction, cursor, page, storage) {
  if (storage && Number.isSafeInteger(page) && page > 0) {
    storage.setItem(pageStorageKey(kind, direction, cursor), String(page));
  }
}

export function cachedCatalogCountRequest(requests, kind, load) {
  let request = requests.get(kind);
  if (!request) {
    request = Promise.resolve().then(load).catch((error) => {
      if (requests.get(kind) === request) requests.delete(kind);
      throw error;
    });
    requests.set(kind, request);
  }
  return request;
}
