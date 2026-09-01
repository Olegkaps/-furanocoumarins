export function resultRowIdentity(
  species: string | null | undefined,
  chemical: string | null | undefined,
  values: ReadonlyMap<string, string | null | undefined>,
  refColumns: readonly string[],
): string;

export function resultGroupIdentity(
  chemicalFields: Iterable<[string, unknown]>,
  speciesFields: Iterable<[string, unknown]>,
): string;
