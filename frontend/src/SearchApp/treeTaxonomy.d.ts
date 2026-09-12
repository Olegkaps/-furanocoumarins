export function selectTreeTaxonomy<T extends { type: string }>(
  metadata: T[], tag?: string,
): { columns: T[]; tags: string[] };
