export type CatalogModelColumn = { column: string; name: string; type: string; description: string };
export function classificationColumn(columns: CatalogModelColumn[], rank: number): string | undefined;
export function recordTitle(kind: "chemicals" | "species" | "publications", columns: CatalogModelColumn[], item: Record<string, unknown>): string;
export function catalogPageNumber(kind: string, cursor: string, before: string, storage?: Pick<Storage, "getItem">): number | null;
export function rememberCatalogPageNumber(kind: string, direction: "cursor" | "before", cursor: string, page: number, storage?: Pick<Storage, "setItem">): void;
export function cachedCatalogCountRequest<K, T>(requests: Map<K, Promise<T>>, kind: K, load: () => Promise<T>): Promise<T>;
