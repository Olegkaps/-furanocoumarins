const bracketMarkers = ["external", "default", "clas", "link", "set"];
const bareTokenPattern = /^[A-Za-z][A-Za-z0-9_]*$/;
const identifierPattern = /^[A-Za-z][A-Za-z0-9_]*$/;

function canonicalToken(token) {
  return token === "smiles" ? "SMILES" : token;
}

function isSpace(value) {
  return value === " " || value === "\t" || value === "\r" || value === "\n";
}

function atBoundary(columnType, cursor) {
  return cursor === columnType.length || isSpace(columnType[cursor]);
}

function readArgument(columnType, opening) {
  if (columnType[opening] !== "[") return null;
  const closing = columnType.indexOf("]", opening + 1);
  if (closing < 0) return null;
  const value = columnType.slice(opening + 1, closing).trim();
  if (!value || value.includes("[") || value.includes("]")) return null;
  return { value, cursor: closing + 1 };
}

/** Parse the complete persisted XLSX metadata grammar without substring matching. */
export function parseMetadataType(columnType) {
  if (typeof columnType !== "string" || !columnType.trim()) return null;
  const tokens = new Set();
  const modifiers = new Map();
  let cursor = 0;

  while (cursor < columnType.length) {
    while (cursor < columnType.length && isSpace(columnType[cursor])) cursor += 1;
    if (cursor >= columnType.length) break;

    if (columnType.startsWith("ref[]", cursor) && atBoundary(columnType, cursor + 5)) {
      tokens.add("ref[]");
      cursor += 5;
      continue;
    }

    const marker = bracketMarkers.find((candidate) =>
      columnType.startsWith(`${candidate}[`, cursor),
    );
    if (!marker) {
      let end = cursor;
      while (end < columnType.length && !isSpace(columnType[end])) end += 1;
      const token = columnType.slice(cursor, end);
      if (!bareTokenPattern.test(token)) return null;
      if (["external", "default", "clas", "link"].includes(token)) return null;
      if (token === "set" && modifiers.has("set")) return null;
      tokens.add(canonicalToken(token));
      cursor = end;
      continue;
    }

    if (modifiers.has(marker)) return null;
    const first = readArgument(columnType, cursor + marker.length);
    if (!first) return null;
    cursor = first.cursor;
    const args = [first.value];
    if (marker === "clas" && columnType[cursor] === "[") {
      const second = readArgument(columnType, cursor);
      if (!second) return null;
      args.push(second.value);
      cursor = second.cursor;
    }
    if (!atBoundary(columnType, cursor)) return null;
    if (marker === "default" && !identifierPattern.test(first.value)) return null;
    if (marker === "set" && tokens.has("set")) return null;
    modifiers.set(marker, args);
    if (marker === "set") tokens.add("set");
  }

  return { tokens, modifiers };
}

/** Test an exact bare label; set[choices] also has the semantic set label. */
export function hasMetadataTypeToken(columnType, expected) {
  const parsed = parseMetadataType(columnType);
  if (!parsed) return false;
  if (parsed.tokens.has(canonicalToken(expected))) return true;
  if ((expected === "table_" || expected === "specie") && parsed.tokens.has("table_specie")) {
    return true;
  }
  if ((expected === "table_" || expected === "chemical") && parsed.tokens.has("table_chemical")) {
    return true;
  }
  return false;
}

function hasUnsafeTemplateCharacters(value) {
  return /[\s\u0000-\u001f\u007f-\u009f\\]/u.test(value);
}

function hasUnsafeLinkValueCharacters(value) {
  return /[\u0000-\u001f\u007f-\u009f\\]/u.test(value);
}

function isSafeMetadataLinkTemplate(template) {
  if (typeof template !== "string" || template.split("%s").length !== 2) return false;
  if (hasUnsafeTemplateCharacters(template)) return false;

  const placeholder = template.indexOf("%s");
  const candidate = template.replace("%s", "safe-value");
  if (template.startsWith("https://")) {
    const authorityTail = template.slice("https://".length);
    const separator = authorityTail.search(/[/?#]/u);
    const authorityEnd = separator < 0 ? template.length : "https://".length + separator;
    if (placeholder < authorityEnd) return false;
    if (!hasPathSegmentPlaceholder(template, placeholder, authorityEnd)) return false;
    try {
      const parsed = new URL(candidate);
      return parsed.protocol === "https:" && parsed.hostname !== "" && parsed.username === "" && parsed.password === "";
    } catch {
      return false;
    }
  }

  if (template.startsWith("/") && !template.startsWith("//") && placeholder > 1) {
    if (!hasPathSegmentPlaceholder(template, placeholder, 0)) return false;
    try {
      const parsed = new URL(candidate, "https://metadata.invalid");
      return parsed.origin === "https://metadata.invalid" && parsed.pathname.startsWith("/");
    } catch {
      return false;
    }
  }
  return false;
}

function hasPathSegmentPlaceholder(template, placeholder, pathStart) {
  const query = template.indexOf("?", pathStart);
  const fragment = template.indexOf("#", pathStart);
  const endings = [query, fragment].filter((index) => index >= 0);
  const pathEnd = endings.length === 0 ? template.length : Math.min(...endings);
  const placeholderEnd = placeholder + "%s".length;
  return placeholder > pathStart &&
    placeholderEnd <= pathEnd &&
    template[placeholder - 1] === "/" &&
    (placeholderEnd === pathEnd || template[placeholderEnd] === "/");
}

function encodeMetadataPathSegment(value) {
  if (value === ".") return "%252E";
  if (value === "..") return "%252E%252E";
  return encodeURIComponent(value);
}

/** Build a clickable URL only from a fixed-authority, prevalidated template. */
export function safeMetadataLink(template, value) {
  if (typeof value !== "string" || hasUnsafeLinkValueCharacters(value) || !isSafeMetadataLinkTemplate(template)) return null;

  let generated;
  try {
    generated = template.replace("%s", encodeMetadataPathSegment(value));
  } catch {
    return null;
  }
  if (!generated || hasUnsafeTemplateCharacters(generated)) return null;

  const base = "https://metadata.invalid";
  try {
    const parsed = new URL(generated, base);
    if (parsed.protocol === "https:" && parsed.username === "" && parsed.password === "") {
      if (parsed.origin === base || generated.startsWith("https://")) return generated;
    }
  } catch {
    return null;
  }
  return null;
}

/** Return structured bracket arguments, or null when absent/invalid. */
export function getMetadataTypeModifier(columnType, marker) {
  return parseMetadataType(columnType)?.modifiers.get(marker) ?? null;
}
