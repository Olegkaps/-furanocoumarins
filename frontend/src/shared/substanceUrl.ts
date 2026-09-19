/** Build a substance page URL that is safe for SMILES containing `/` and other reserved characters. */
export function substancePagePath(smiles: string): string {
  return `/page?smiles=${encodeURIComponent(smiles)}`;
}

/** Stable source ID URL for a chemical. Legacy SMILES URLs remain readable. */
export function chemicalPagePath(id: string): string {
  return `/chemical/${encodeURIComponent(id)}`;
}
