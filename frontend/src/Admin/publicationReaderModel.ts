export type Publication = { title: string; pages: { number: number; text: string }[]; source_url?: string; warnings: string[] };
export type Evidence = { page: number; quote: string; field?: string };
export type Finding = { chemical: string; species: string; methods: string[]; chirality: string; evidence: Evidence[]; mentions?: Evidence[]; association_note?: string };
export type Analysis = { findings: Finding[]; warnings: string[] };
export type ReaderStatus = { configured: boolean; provider: string; warnings?: string[]; sourceBytes?: number };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid publication reader response.");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid publication reader text.");
  return value;
}
function list<T>(value: unknown, read: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error("Invalid publication reader list.");
  return value.map(read);
}
function pageNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error("Invalid publication page number.");
  return value;
}
export function readStatus(value: unknown): ReaderStatus {
  const data = object(value);
  if (typeof data.configured !== "boolean") throw new Error("Invalid provider configuration response.");
  const sourceBytes = data.limits === undefined ? undefined : pageNumber(object(data.limits).source_bytes);
  return { configured: data.configured, provider: string(data.provider),
    ...(data.warnings === undefined ? {} : { warnings: list(data.warnings, string) }),
    ...(sourceBytes === undefined ? {} : { sourceBytes }) };
}
export function readDocument(value: unknown): Publication {
  const data = object(value);
  const pages = list(data.pages, value => { const page = object(value); return { number: pageNumber(page.number), text: string(page.text) }; });
  if (new Set(pages.map(page => page.number)).size !== pages.length) throw new Error("Duplicate publication page numbers.");
  return { title: string(data.title), pages, warnings: list(data.warnings, string), ...(data.source_url === undefined ? {} : { source_url: string(data.source_url) }) };
}
export function readAnalysis(value: unknown): Analysis {
  const data = object(value);
  return { warnings: list(data.warnings, string), findings: list(data.findings, value => {
    const finding = object(value);
    return { chemical: string(finding.chemical), species: string(finding.species), methods: list(finding.methods, string),
      chirality: string(finding.chirality).trim() || "Unknown",
      ...(finding.association_note === undefined ? {} : { association_note: string(finding.association_note) }),
      ...(finding.mentions === undefined ? {} : { mentions: list(finding.mentions, readEvidence) }), evidence: list(finding.evidence, value => {
        const evidence = object(value); return { page: pageNumber(evidence.page), quote: string(evidence.quote), ...(evidence.field === undefined ? {} : { field: string(evidence.field) }) };
      }) };
  }) };
}
function readEvidence(value: unknown): Evidence {
  const item = object(value);
  return { page: pageNumber(item.page), quote: string(item.quote), ...(item.field === undefined ? {} : { field: string(item.field) }) };
}

export const MAX_REVIEW_BYTES = 8 * 1024 * 1024;
export function readReviewBundle(value: unknown): { publication: Publication; analysis: Analysis } {
  const bundle = object(value);
  let publication: Publication, analysis: Analysis;
  if (bundle.sections !== undefined) {
    const sections = list(bundle.sections, object);
    const numbers = new Map(sections.map((section, index) => [string(section.id), index + 1]));
    if (numbers.size !== sections.length) throw new Error("Duplicate publication section IDs.");
    publication = readDocument({ title: bundle.title, source_url: bundle.source_url,
      warnings: [...list(bundle.warnings, string), ...(bundle.source_note ? [string(bundle.source_note)] : []), "Imported sections use logical page numbers, not printed pages."],
      pages: sections.map((section, index) => ({ number: index + 1, text: string(section.text) })) });
    const convert = (value: unknown) => {
      const evidence = object(value);
      const page = numbers.get(string(evidence.section_id));
      if (!page) throw new Error("Evidence references an unknown publication section.");
      return { ...evidence, page };
    };
    analysis = readAnalysis({ warnings: [], findings: list(bundle.findings, value => {
      const finding = object(value);
      return { ...finding, evidence: list(finding.evidence, convert),
        ...(finding.mentions === undefined ? {} : { mentions: list(finding.mentions, convert) }) };
    }) });
  } else {
    publication = readDocument(bundle.document);
    analysis = readAnalysis(bundle.analysis);
  }
  if (publication.pages.length > 1000 || analysis.findings.length > 500 ||
    publication.pages.reduce((sum, page) => sum + page.text.length, 0) > 1000000 ||
    analysis.findings.some(finding => finding.evidence.length + (finding.mentions?.length ?? 0) > 100)) {
    throw new Error("Extraction exceeds review limits (1,000 pages, 500 pairs, 100 quotations per pair, 1 million text characters).");
  }
  return { publication, analysis };
}

export type HighlightRange = { start: number; end: number; kind: "context" | "species" | "chemical" | "active" };
export function findingHighlights(publication: Publication, finding: Finding | undefined, active?: Evidence) {
  const pages = new Map<number, HighlightRange[]>();
  if (!finding) return pages;
  let remaining = MAX_HIGHLIGHT_RANGES;
  const add = (page: number, start: number, end: number, kind: HighlightRange["kind"]) => {
    if (remaining <= 0) return;
    remaining--;
    const ranges = pages.get(page) ?? []; ranges.push({ start, end, kind }); pages.set(page, ranges);
  };
  // Prioritize the clicked fact, then exact mentions, before broad context.
  if (active) for (const start of evidenceMatches(publication, active)) add(active.page, start, start + active.quote.length, "active");
  for (const mention of finding.mentions ?? []) {
    if (mention.field !== "species" && mention.field !== "chemical") continue;
    for (const start of evidenceMatches(publication, mention)) add(mention.page, start, start + mention.quote.length, mention.field);
  }
  for (const evidence of finding.evidence) for (const start of evidenceMatches(publication, evidence)) {
    add(evidence.page, start, start + evidence.quote.length, "context");
    if (finding.mentions?.length) continue;
    const kind = evidence.field;
    const name = kind === "species" ? finding.species : kind === "chemical" ? finding.chemical : "";
    if (name && (kind === "species" || kind === "chemical")) {
      for (let at = evidence.quote.indexOf(name), count = 0; at >= 0 && count < MAX_QUOTE_MATCHES; at = evidence.quote.indexOf(name, at + name.length), count++) {
        add(evidence.page, start + at, start + at + name.length, kind);
      }
    }
  }
  return pages;
}
export function coloredHighlightParts(text: string, ranges: HighlightRange[]) {
  const kinds: HighlightRange["kind"][] = ["context", "species", "chemical", "active"];
  const changes = new Map<number, number[]>([[0, [0, 0, 0, 0]], [text.length, [0, 0, 0, 0]]]);
  for (const range of ranges) for (const [at, delta] of [[range.start, 1], [range.end, -1]]) {
    const counts = changes.get(at) ?? [0, 0, 0, 0]; counts[kinds.indexOf(range.kind)] += delta; changes.set(at, counts);
  }
  const boundaries = [...changes.keys()].sort((a, b) => a - b), counts = [0, 0, 0, 0];
  return boundaries.slice(0, -1).map((start, i) => {
    changes.get(start)!.forEach((delta, kind) => { counts[kind] += delta; });
    const kind = counts[3] ? kinds[3] : counts[2] ? kinds[2] : counts[1] ? kinds[1] : counts[0] ? kinds[0] : undefined;
    return { start, text: text.slice(start, boundaries[i + 1]), kind };
  });
}
export const MAX_QUOTE_MATCHES = 20;
export const MAX_HIGHLIGHT_RANGES = 1000;
export function evidenceKey(evidence: Evidence): string { return JSON.stringify([evidence.page, evidence.quote]); }
export function evidenceMatches(document: Publication, evidence: Evidence, limit = MAX_QUOTE_MATCHES): number[] {
  const text = document.pages.find(page => page.number === evidence.page)?.text;
  if (text === undefined || !evidence.quote.trim() || limit <= 0) return [];
  const matches: number[] = [];
  for (let start = text.indexOf(evidence.quote); start !== -1 && matches.length < limit; start = text.indexOf(evidence.quote, start + 1)) matches.push(start);
  return matches;
}
export function buildEvidenceIndex(publication: Publication, findings: Finding[]) {
  const matches = new Map<string, { starts: number[]; omitted: boolean; unsearched?: boolean }>();
  const ranges = new Map<number, { start: number; end: number }[]>();
  const seenRanges = new Set<string>();
  let remaining = MAX_HIGHLIGHT_RANGES;
  for (const finding of findings) for (const evidence of finding.evidence) {
    const key = evidenceKey(evidence);
    if (matches.has(key)) continue;
    // Once the document budget is exhausted, skip new searches as well as DOM marks.
    if (!remaining) { matches.set(key, { starts: [], omitted: true, unsearched: true }); continue; }
    const found = evidenceMatches(publication, evidence, MAX_QUOTE_MATCHES + 1);
    const starts: number[] = [];
    for (const start of found.slice(0, MAX_QUOTE_MATCHES)) {
      const end = start + evidence.quote.length;
      const rangeKey = `${evidence.page}:${start}:${end}`;
      if (!seenRanges.has(rangeKey)) {
        if (!remaining) break;
        seenRanges.add(rangeKey); remaining--;
        const pageRanges = ranges.get(evidence.page) ?? [];
        pageRanges.push({ start, end }); ranges.set(evidence.page, pageRanges);
      }
      starts.push(start);
    }
    matches.set(key, { starts, omitted: found.length > starts.length });
  }
  return { matches, ranges };
}
export function passageID(page: number, start: number): string { return `publication-p${page}-at${start}`; }
export function jumpToPassage(id: string) {
  const target = document.getElementById(id);
  target?.scrollIntoView({ block: "center", behavior: "auto" });
  target?.focus({ preventScroll: true });
}
export function highlightParts(text: string, ranges: { start: number; end: number }[]) {
  const changes = new Map<number, number>([[0, 0], [text.length, 0]]);
  for (const { start, end } of ranges) {
    changes.set(start, (changes.get(start) ?? 0) + 1);
    changes.set(end, (changes.get(end) ?? 0) - 1);
  }
  const boundaries = [...changes.keys()].sort((a, b) => a - b);
  let active = 0;
  return boundaries.slice(0, -1).map((start, index) => {
    active += changes.get(start) ?? 0;
    return { start, text: text.slice(start, boundaries[index + 1]), highlighted: active > 0 };
  });
}

// Invalidate synchronously: cancellation remains safe even if a transport resolves after abort.
export function requestSlot() {
  let current: AbortController | undefined;
  return {
    cancel() { current?.abort(); current = undefined; },
    begin() { current?.abort(); const controller = new AbortController(); current = controller;
      return { signal: controller.signal, active: () => current === controller && !controller.signal.aborted };
    },
  };
}
