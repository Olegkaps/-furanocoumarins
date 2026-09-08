function normalizedValue(value) {
  return value == null ? null : String(value);
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function structuredValue(value) {
  if (value === null) return ["null"];
  if (Array.isArray(value)) return ["array", value.map(structuredValue)];
  if (typeof value === "object") {
    return [
      "object",
      Object.keys(value)
        .sort(compareNames)
        .map((name) => [name, structuredValue(value[name])]),
    ];
  }
  return [typeof value, value];
}

/**
 * Identify the chemical/species group before upstream values are coerced to
 * display strings. Named JSON tuples preserve field boundaries, scalar types,
 * and array order, so concatenation-shaped values cannot share a group.
 */
export function resultGroupIdentity(chemicalFields, speciesFields) {
  const fields = (entries) => [...entries]
    .map(([name, value]) => [name, structuredValue(value)])
    .sort(([left], [right]) => compareNames(left, right));
  return JSON.stringify([
    "scientific-result-group",
    ["chemical", fields(chemicalFields)],
    ["species", fields(speciesFields)],
  ]);
}

/**
 * Return a stable identity for one scientific result row.
 *
 * References identify repeated copies of the same observation across compare
 * series, but only within the same species/chemical pair. Rows without a
 * reference fall back to their complete value map. JSON tuple encoding avoids
 * collisions from separators embedded in names or values.
 */
export function resultRowIdentity(species, chemical, values, refColumns) {
  const references = [...new Set(refColumns)]
    .sort(compareNames)
    .map((column) => [column, normalizedValue(values.get(column))]);
  const hasReference = references.some(([, value]) => value !== null && value !== "");
  const valueIdentity = hasReference
    ? ["references", references]
    : [
        "values",
        [...values.entries()]
          .map(([name, value]) => [name, normalizedValue(value)])
          .sort(([left], [right]) => compareNames(left, right)),
      ];

  return JSON.stringify([
    "scientific-result-row",
    normalizedValue(species),
    normalizedValue(chemical),
    valueIdentity,
  ]);
}
