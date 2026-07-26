/** Build a substance page URL that is safe for SMILES containing `/` and other reserved characters. */
export function substancePagePath(smiles: string): string {
  return `/page?smiles=${encodeURIComponent(smiles)}`;
}
