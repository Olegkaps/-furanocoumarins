import type { OmicsSource } from "./omics";

export type StoredProviderIDs = Partial<Record<"ncbi" | "ena" | "uniprot" | "ensembl-plants", string>>;

const numericSources = new Set<OmicsSource>(["ncbi", "ena", "uniprot", "ensembl-plants"]);

export function storedProviderID(source: OmicsSource, ids: StoredProviderIDs | undefined): string | undefined {
  const value = numericSources.has(source) ? ids?.[source as keyof StoredProviderIDs]?.trim() : undefined;
  return value || undefined;
}

export function needsProviderTaxonomy(sources: OmicsSource[], ids: StoredProviderIDs | undefined): boolean {
  return sources.some(source => numericSources.has(source) && !storedProviderID(source, ids));
}

export function isNumericProvider(source: OmicsSource): boolean { return numericSources.has(source); }
