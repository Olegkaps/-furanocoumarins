export function selectTreeTaxonomy<T extends { type: string }>(
  metadata: T[], tag?: string,
): { columns: T[]; tags: string[] };

export function canShowPhylogeneticTree(
  response: { metadata?: Array<{ type: string; column: string }>; data?: Array<Record<string, unknown>> },
  compareSeries?: Array<{ response: { data?: Array<Record<string, unknown>> } }>,
  tag?: string,
): boolean;
