export interface BibtexEntry {
  citationKey?: string;
  entryType?: string;
  author?: string;
  title?: string;
  journal?: string;
  booktitle?: string;
  year?: string;
  volume?: string;
  number?: string;
  pages?: string;
  doi?: string;
  url?: string;
  publisher?: string;
}

const TEX_SPECIAL: Record<string, string> = {
  aa: "å",
  AA: "Å",
  ae: "æ",
  AE: "Æ",
  oe: "œ",
  OE: "Œ",
  o: "ø",
  O: "Ø",
  l: "ł",
  L: "Ł",
  ss: "ß",
  i: "ı",
  j: "ȷ",
  copyright: "©",
  pounds: "£",
  euro: "€",
  S: "§",
  P: "¶",
  dag: "†",
  ddag: "‡",
};

const ACCENT_MAP: Record<string, (c: string) => string> = {
  "'": (c) =>
    ({ a: "á", e: "é", i: "í", o: "ó", u: "ú", y: "ý", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú", Y: "Ý", n: "ń", N: "Ń", c: "ć", C: "Ć", s: "ś", S: "Ś", z: "ź", Z: "Ź" }[c] ?? c),
  "`": (c) =>
    ({ a: "à", e: "è", i: "ì", o: "ò", u: "ù", A: "À", E: "È", I: "Ì", O: "Ò", U: "Ù" }[c] ?? c),
  "^": (c) =>
    ({ a: "â", e: "ê", i: "î", o: "ô", u: "û", A: "Â", E: "Ê", I: "Î", O: "Ô", U: "Û" }[c] ?? c),
  '"': (c) =>
    ({ a: "ä", e: "ë", i: "ï", o: "ö", u: "ü", y: "ÿ", A: "Ä", E: "Ë", I: "Ï", O: "Ö", U: "Ü", s: "ß" }[c] ?? c),
  "~": (c) =>
    ({ a: "ã", n: "ñ", o: "õ", A: "Ã", N: "Ñ", O: "Õ" }[c] ?? c),
  "=": (c) =>
    ({ a: "ā", e: "ē", i: "ī", o: "ō", u: "ū", A: "Ā", E: "Ē", I: "Ī", O: "Ō", U: "Ū" }[c] ?? c),
  ".": (c) =>
    ({ z: "ż", Z: "Ż", i: "ı" }[c] ?? c),
  c: (c) =>
    ({ c: "ç", C: "Ç", s: "ş", S: "Ş" }[c] ?? c),
};

/** Strip TeX/HTML markup and protective braces from a BibTeX field value. */
export function cleanBibtexValue(raw: string): string {
  let s = raw.replace(/\r\n?/g, "\n").trim();

  // Unwrap one layer of outer braces repeatedly ({{Title}} → Title)
  for (let n = 0; n < 8; n++) {
    if (s.startsWith("{") && s.endsWith("}") && balancedOuter(s)) {
      s = s.slice(1, -1).trim();
    } else {
      break;
    }
  }

  // HTML tags and entities
  s = s.replace(/<[^>]+>/g, "");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—");

  // \textit{...}, \emph{...}, \textbf{...}, etc. — keep inner text
  const wrapping =
    /\\(textit|textbf|emph|textrm|mathrm|mathit|mathbf|underline|textsc|textsf|textrm|texttt|mathrm)\s*\{([^{}]*)\}/gi;
  for (let n = 0; n < 12; n++) {
    const next = s.replace(wrapping, "$2");
    if (next === s) break;
    s = next;
  }

  s = s.replace(/\\url\s*\{([^{}]*)\}/gi, "$1");
  s = s.replace(/\\href\s*\{[^{}]*\}\s*\{([^{}]*)\}/gi, "$1");

  // Accents: {\'e}, \'{e}, \'e
  s = s.replace(/\{\\([`'^=~.c"])\s*([A-Za-z])\}/g, (_, accent: string, ch: string) => {
    const map = ACCENT_MAP[accent];
    return map ? map(ch) : ch;
  });
  s = s.replace(/\\([`'^=~.c"])\s*\{([A-Za-z])\}/g, (_, accent: string, ch: string) => {
    const map = ACCENT_MAP[accent];
    return map ? map(ch) : ch;
  });
  s = s.replace(/\\([`'^=~.c"])\s*([A-Za-z])/g, (_, accent: string, ch: string) => {
    const map = ACCENT_MAP[accent];
    return map ? map(ch) : ch;
  });

  // {\AA}, {\ss}, ...
  s = s.replace(/\{\\([A-Za-z]+)\}/g, (_, cmd: string) => TEX_SPECIAL[cmd] ?? cmd);

  // Remaining commands without args
  s = s.replace(/\\[a-zA-Z]+\*?/g, "");
  // Escaped punctuation
  s = s.replace(/\\([&%$#_{}~^])/g, "$1");

  // Protective braces around single tokens / leftover braces
  for (let n = 0; n < 8; n++) {
    const next = s.replace(/\{([^{}]*)\}/g, "$1");
    if (next === s) break;
    s = next;
  }
  s = s.replace(/[{}]/g, "");

  // Tilde as non-breaking space in TeX
  s = s.replace(/~/g, " ");
  s = s.replace(/--+/g, "–");
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

function balancedOuter(s: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) return i === s.length - 1;
      if (depth < 0) return false;
    }
  }
  return false;
}

function extractFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = 0;

  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i]!)) i++;
    if (i >= body.length || body[i] === "}") break;

    const rest = body.slice(i);
    const keyMatch = rest.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s*=\s*/);
    if (!keyMatch) break;

    i += keyMatch[0].length;
    const key = keyMatch[1]!.toLowerCase();
    let value = "";

    if (body[i] === "{") {
      let depth = 0;
      const start = i;
      for (; i < body.length; i++) {
        if (body[i] === "{") depth++;
        else if (body[i] === "}") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
      }
      value = body.slice(start + 1, i - 1);
    } else if (body[i] === '"') {
      i++;
      const start = i;
      while (i < body.length && body[i] !== '"') i++;
      value = body.slice(start, i);
      if (body[i] === '"') i++;
    } else {
      const start = i;
      while (i < body.length && body[i] !== "," && body[i] !== "}") i++;
      value = body.slice(start, i).trim();
    }

    fields[key] = value;
  }

  return fields;
}

/** Parse a single BibTeX entry into cleaned fields. */
export function parseBibtex(bibtexStr: string): BibtexEntry | null {
  if (!bibtexStr?.trim()) return null;

  const text = bibtexStr.trim();
  const header = text.match(/@(\w+)\s*\{\s*([^,\s]+)\s*,/);
  const braceStart = text.indexOf("{");
  if (braceStart < 0) return null;

  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;

  const inner = text.slice(braceStart + 1, end);
  const comma = inner.indexOf(",");
  const body = comma >= 0 ? inner.slice(comma + 1) : inner;
  const rawFields = extractFields(body);

  const entry: BibtexEntry = {
    entryType: header?.[1]?.toLowerCase(),
    citationKey: header?.[2],
  };

  for (const [key, raw] of Object.entries(rawFields)) {
    const cleaned = cleanBibtexValue(raw);
    if (cleaned) {
      (entry as Record<string, string | undefined>)[key] = cleaned;
    }
  }

  if (!entry.author && !entry.title) {
    return null;
  }

  return entry;
}

export function formatAuthors(author: string | undefined): string {
  if (!author) return "";
  return author
    .split(/\s+and\s+/i)
    .map((name) => name.trim())
    .filter(Boolean)
    .join(", ");
}

function ensureSentenceEnd(text: string): string {
  const t = text.trim();
  if (!t) return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** Plain-text APA-like citation for clipboard. */
export function formatCitationPlain(entry: BibtexEntry): string {
  const authors = formatAuthors(entry.author);
  const title = entry.title ?? "";
  const venue = entry.journal || entry.booktitle || "";
  let journalInfo = venue;
  if (venue) {
    if (entry.volume) journalInfo += `, ${entry.volume}`;
    if (entry.number) journalInfo += `(${entry.number})`;
    if (entry.pages) journalInfo += `: ${entry.pages}`;
  }
  const year = entry.year ? `(${entry.year})` : "";
  const parts = [
    authors ? ensureSentenceEnd(authors) : "",
    title ? ensureSentenceEnd(title) : "",
    journalInfo ? ensureSentenceEnd(journalInfo) : "",
    year,
  ].filter(Boolean);
  let text = parts.join(" ").replace(/\s+/g, " ").trim();
  if (entry.doi) {
    text += ` https://doi.org/${entry.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}`;
  } else if (entry.url) {
    text += ` ${entry.url}`;
  }
  return text;
}

export function doiHref(doi: string): string {
  const cleaned = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
  return `https://doi.org/${cleaned}`;
}

const articleCache = new Map<string, Promise<string>>();

/** Fetch raw BibTeX for an article id (cached). */
export function fetchArticleBibtex(
  articleId: string,
  getter: (id: string) => Promise<string>,
): Promise<string> {
  const key = articleId.trim();
  const existing = articleCache.get(key);
  if (existing) return existing;
  const promise = getter(key).catch((err) => {
    articleCache.delete(key);
    throw err;
  });
  articleCache.set(key, promise);
  return promise;
}
