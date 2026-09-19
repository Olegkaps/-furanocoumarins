export type TaxonLink = { rank: number; name: string; id?: string; source_column?: string };

export type Taxon = TaxonLink & {
  title: string;
  query_column?: string;
  parent?: TaxonLink;
  children: TaxonLink[];
};

// The key is reversible, includes both stable identity fields, and stays safe
// for the ordinary Markdown-page storage path.
export function taxonPageName(rank: number, name: string): string {
  return `taxon:${rank}:${encodeURIComponent(name)}`;
}

export function taxonPath(link: TaxonLink): string {
  if (link.id) return speciesPagePath(link.id);
  return `/taxon/${link.rank}?name=${encodeURIComponent(link.name)}`;
}

/** Stable source ID URL for a species. Legacy taxonomy URLs remain readable. */
export function speciesPagePath(id: string): string {
  return `/species/${encodeURIComponent(id)}`;
}

// Source IDs are complete identities on their own. The display name arrives
// from taxonomy asynchronously and must not decide whether an ID route exists.
export function taxonRouteIsValid(id: string | undefined, rank: number, name: string): boolean {
  return Boolean(id) || (Number.isInteger(rank) && name !== "");
}

// Species are stored as epithets; show a useful scientific name when they are
// listed below their genus without changing the stable child-page identity.
export function taxonChildLabel(parent: TaxonLink, child: TaxonLink): string {
  return parent.rank === 1 && child.rank === 0 ? `${parent.name} ${child.name}` : child.name;
}
