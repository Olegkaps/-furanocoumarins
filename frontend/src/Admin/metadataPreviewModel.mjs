// A presentation-only projection. It never imports data, validates publication,
// or fetches records; the backend remains authoritative for saved definitions.
export function columnDomain(sheetName, column) {
  return sheetName.startsWith("structures") || column.external_sheet === "structures" ? "chemical"
    : sheetName.startsWith("classification") || column.external_sheet === "classification" ? "species"
    : [sheetName, column.external_sheet].some(name => name === "publication" || name === "publications") ? "publication" : column.domain;
}

export function copyCommonColumn(sheetName, column) {
  return { ...column, domain: columnDomain(sheetName, column), primary_key: false, external_sheet: undefined };
}

export function buildMetadataPreview(document) {
  const model = { columns: [], search: [], results: [], chemicals: [], species: [], structures: [], classification: [], sourceOnly: [], errors: [], warnings: [] };
  if (!document || ![1, 2].includes(document.schema_version) || !document.importable || !Array.isArray(document.sheets)) {
    model.errors.push("Complete a valid, importable JSON definition to see previews.");
    return model;
  }
  const sheets = new Map();
  for (const sheet of document.sheets) {
    if (!sheet?.name || !Array.isArray(sheet.columns) || sheets.has(sheet.name)) {
      model.errors.push("Each sheets group needs a unique name and columns.");
      return model;
    }
    sheets.set(sheet.name, sheet);
  }
  const reachable = new Set(), visiting = new Set();
  const visit = name => {
    if (visiting.has(name)) { model.errors.push(`Cyclic join at ${name}.`); return; }
    if (reachable.has(name)) return;
    const sheet = sheets.get(name);
    if (!sheet) { model.errors.push(`Missing joined sheet: ${name}.`); return; }
    reachable.add(name); visiting.add(name);
    for (const column of sheet.columns) if (column?.external_sheet) visit(column.external_sheet);
    visiting.delete(name);
  };
  visit("main");
  const columns = new Map(), signatures = new Map();
  for (const sheet of document.sheets) {
    if (!reachable.has(sheet.name)) { model.sourceOnly.push(sheet.name); continue; }
    for (const column of sheet.columns) {
      if (!column?.name || !["text", "set"].includes(column.data_type)) { model.errors.push(`Complete the column names and types in ${sheet.name}.`); continue; }
      const inferred = columnDomain(sheet.name, column);
      if (inferred && column.domain && column.domain !== inferred) model.errors.push(`${column.name}: entity conflicts with its sheet or join.`);
      const c = { ...column, domain: inferred || column.domain, sheet: sheet.name };
      const signature = JSON.stringify([
        c.data_type, c.description || "", c.domain || "", c.default_column || "", !!c.search, !!c.show_in_results,
        c.result_order ?? null, !!c.hidden, !!c.reference, !!c.smiles, !!c.list_name, c.classification?.level ?? null,
        c.classification?.tag || "", c.link_template || "", c.set_choices ?? [],
        (c.legacy_flags ?? []).filter(flag => flag !== "keycolumn").sort(),
      ]);
      const key = c.name.toLowerCase();
      if (columns.has(key)) {
        if (signatures.get(key) !== signature) model.errors.push(`${c.name}: joined definitions disagree. Match their column settings to preview reliably.`);
        else if (columns.get(key).label !== c.label) model.warnings.push(`${c.name}: joined labels differ; the preview uses the first label.`);
      } else { columns.set(key, c); signatures.set(key, signature); }
    }
  }
  model.columns = [...columns.values()];
  model.search = model.columns.filter(c => c.search && ["chemical", "species"].includes(c.domain));
  if (model.columns.some(c => c.search && !["chemical", "species"].includes(c.domain))) model.warnings.push("Search fields need a Chemical or Species entity to appear in the current public search form. Publication is reserved for future use.");
  const displayed = model.columns.filter(c => c.show_in_results && !c.hidden).sort((a, b) => (a.result_order ?? Infinity) - (b.result_order ?? Infinity));
  model.results = displayed.filter(c => !c.domain || c.domain === "publication");
  const isStructure = c => c.smiles && !c.link_template && !c.classification;
  model.chemicals = displayed.filter(c => c.domain === "chemical" && !isStructure(c));
  model.species = displayed.filter(c => c.domain === "species");
  model.structures = model.columns.filter(c => isStructure(c) && !c.hidden);
  model.classification = model.columns.filter(c => c.classification && !c.hidden).sort((a, b) => b.classification.level - a.classification.level);
  return model;
}

// Every level reserves the same ordered lanes, including systems missing there.
export function classificationRows(columns) {
  const levels = new Map(), tags = new Set();
  const alphabetical = (a, b) => a.localeCompare(b, "en") || (a < b ? -1 : a > b ? 1 : 0);
  for (const column of columns) {
    const level = column.classification?.level;
    if (!Number.isFinite(level) || column.hidden) continue;
    const tag = column.classification.tag || "default";
    tags.add(tag);
    if (!levels.has(level)) levels.set(level, new Map());
    const lanes = levels.get(level);
    if (!lanes.has(tag)) lanes.set(tag, []);
    lanes.get(tag).push(column);
  }
  const orderedTags = [...tags].sort((a, b) => a === "default" ? -1 : b === "default" ? 1 : alphabetical(a, b));
  return [...levels].sort(([a], [b]) => b - a).map(([level, groups]) => {
    const lanes = orderedTags.map(tag => ({ tag, columns: (groups.get(tag) || []).sort((a, b) => alphabetical(a.name, b.name)) }));
    return { level, columns: lanes.flatMap(lane => lane.columns), lanes };
  });
}

export function previewQuery(columns, values) {
  return columns.flatMap(c => {
    const value = (values[c.name] ?? "").trim();
    return value ? [`${c.name}${c.data_type === "set" ? " CONTAINS " : " = "}'${value.replaceAll("'", "''")}'`] : [];
  }).join(" AND ");
}

export function previewValue(column) {
  return column.example ?? `value from column ${column.name}`;
}
