import type { AxiosRequestConfig, AxiosResponse } from "axios";
import config from "../config";
import { api } from "./api";

const LS_PREFIX = "fuco-api-cache:v2:";
const IDB_NAME = "fuco-api-cache";
const IDB_STORE = "entries";
const IDB_VERSION = 1;

type CacheEntry = {
  expiresAt: number;
  writtenAt: number;
  /** Logical key (e.g. search query) — reject hash collisions on read. */
  key: string;
  data: unknown;
};

const inflight = new Map<string, Promise<AxiosResponse>>();
const memory = new Map<string, CacheEntry>();

let idbPromise: Promise<IDBDatabase> | null = null;

/** Drop legacy / oversized localStorage cache keys that used to thrash quota. */
function purgeLegacyLocalStorage(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (
        key.startsWith("fuco-api-cache:") ||
        key.startsWith("fuco-api-cache:v1:")
      ) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

purgeLegacyLocalStorage();

function ttlMs(): number {
  const ttl = config["API_CACHE_TTL_MS"];
  return Number.isFinite(ttl) && ttl > 0 ? ttl : 0;
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function entryId(kind: string, logicalKey: string): string {
  return `${kind}:${fnv1a(logicalKey)}`;
}

function openIdb(): Promise<IDBDatabase> {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
  return idbPromise;
}

async function idbGet(id: string): Promise<CacheEntry | null> {
  try {
    const db = await openIdb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(id);
      req.onsuccess = () => resolve((req.result as CacheEntry) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet(id: string, entry: CacheEntry): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(IDB_STORE).put(entry, id);
  });
}

function entryMatches(entry: CacheEntry | null, expectedKey: string, now: number): boolean {
  return (
    entry != null &&
    entry.expiresAt > now &&
    entry.key === expectedKey
  );
}

/**
 * Mirror only small non-search entries to localStorage (DevTools).
 * Search payloads are large and previously blew LS quota / eviction.
 */
function lsSetSmall(id: string, entry: CacheEntry): void {
  if (id.startsWith("s:")) return;
  const key = LS_PREFIX + id;
  try {
    const payload = JSON.stringify(entry);
    if (payload.length > 100_000) return;
    localStorage.setItem(key, payload);
  } catch {
    /* ignore quota — IndexedDB is the real store */
  }
}

function lsGet(id: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + id);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

async function readEntry(id: string, expectedKey: string): Promise<unknown | null> {
  const now = Date.now();

  const mem = memory.get(id);
  if (mem) {
    if (entryMatches(mem, expectedKey, now)) return mem.data;
    memory.delete(id);
  }

  const fromLs = lsGet(id);
  if (entryMatches(fromLs, expectedKey, now)) {
    memory.set(id, fromLs!);
    return fromLs!.data;
  }

  const fromIdb = await idbGet(id);
  if (entryMatches(fromIdb, expectedKey, now)) {
    memory.set(id, fromIdb!);
    return fromIdb!.data;
  }

  return null;
}

async function writeEntry(
  id: string,
  expectedKey: string,
  data: unknown,
): Promise<void> {
  const ttl = ttlMs();
  if (ttl <= 0) return;
  const now = Date.now();
  const entry: CacheEntry = {
    expiresAt: now + ttl,
    writtenAt: now,
    key: expectedKey,
    data,
  };
  memory.set(id, entry);
  try {
    await idbSet(id, entry);
  } catch {
    // IndexedDB unavailable — fall back to localStorage for small payloads only.
  }
  lsSetSmall(id, entry);
}

async function idbDelete(id: string): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(IDB_STORE).delete(id);
    });
  } catch {
    /* ignore */
  }
}

async function idbClear(): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(IDB_STORE).clear();
    });
  } catch {
    /* ignore */
  }
}

async function idbList(): Promise<Array<{ id: string; entry: CacheEntry }>> {
  try {
    const db = await openIdb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).openCursor();
      const out: Array<{ id: string; entry: CacheEntry }> = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          out.push({ id: String(cursor.key), entry: cursor.value as CacheEntry });
          cursor.continue();
        } else {
          resolve(out);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

function lsRemove(id: string): void {
  try {
    localStorage.removeItem(LS_PREFIX + id);
  } catch {
    /* ignore */
  }
}

function kindFromId(id: string): ApiCacheKind {
  if (id.startsWith("s:")) return "search";
  if (id.startsWith("metadata:")) return "metadata";
  if (id.startsWith("article:")) return "article";
  return "other";
}

export type ApiCacheKind = "search" | "metadata" | "article" | "other";

export type ApiCacheInfo = {
  id: string;
  kind: ApiCacheKind;
  /** Logical key (search query, metadata, article path). */
  key: string;
  writtenAt: number;
  expiresAt: number;
  expired: boolean;
  sources: Array<"memory" | "idb" | "localStorage">;
};

/** List all API cache entries (memory + IndexedDB + small localStorage mirrors). */
export async function listApiCache(): Promise<ApiCacheInfo[]> {
  const now = Date.now();
  const byId = new Map<
    string,
    {
      entry: CacheEntry;
      sources: Set<"memory" | "idb" | "localStorage">;
    }
  >();

  const add = (
    id: string,
    entry: CacheEntry,
    source: "memory" | "idb" | "localStorage",
  ) => {
    if (!entry || typeof entry.key !== "string") return;
    const cur = byId.get(id);
    if (!cur) {
      byId.set(id, { entry, sources: new Set([source]) });
      return;
    }
    cur.sources.add(source);
    // Prefer the freshest write.
    if ((entry.writtenAt ?? 0) >= (cur.entry.writtenAt ?? 0)) {
      cur.entry = entry;
    }
  };

  memory.forEach((entry, id) => add(id, entry, "memory"));

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const full = localStorage.key(i);
      if (!full?.startsWith(LS_PREFIX)) continue;
      const id = full.slice(LS_PREFIX.length);
      const entry = lsGet(id);
      if (entry) add(id, entry, "localStorage");
    }
  } catch {
    /* ignore */
  }

  for (const { id, entry } of await idbList()) {
    add(id, entry, "idb");
  }

  const list: ApiCacheInfo[] = [];
  byId.forEach(({ entry, sources }, id) => {
    list.push({
      id,
      kind: kindFromId(id),
      key: entry.key,
      writtenAt: entry.writtenAt,
      expiresAt: entry.expiresAt,
      expired: !(entry.expiresAt > now),
      sources: [...sources],
    });
  });

  list.sort((a, b) => b.writtenAt - a.writtenAt);
  return list;
}

/** Remove one cache entry from memory, localStorage, and IndexedDB. */
export async function deleteApiCacheEntry(id: string): Promise<void> {
  memory.delete(id);
  lsRemove(id);
  await idbDelete(id);
}

/** Wipe the entire API response cache. */
export async function clearApiCache(): Promise<void> {
  memory.clear();
  inflight.clear();
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LS_PREFIX) || key?.startsWith("fuco-api-cache:")) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  await idbClear();
}

function asAxiosOk(
  url: string,
  data: unknown,
  reqConfig?: AxiosRequestConfig,
): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config: {
      ...(reqConfig ?? {}),
      url,
      method: "get",
    } as AxiosResponse["config"],
  };
}

function isNonEmptySearch(data: unknown): boolean {
  const body = data as { data?: unknown };
  return Array.isArray(body?.data) && body.data.length > 0;
}

function isNonEmptyMetadata(data: unknown): boolean {
  const body = data as { metadata?: unknown };
  return Array.isArray(body?.metadata) && body.metadata.length > 0;
}

function isNonEmptyArticle(data: unknown): boolean {
  const body = data as { val?: unknown };
  if (typeof body?.val === "string") return body.val.trim() !== "";
  if (typeof data === "string") return data.trim() !== "";
  return false;
}

/**
 * Cached /search by the raw query string.
 * Persists in IndexedDB (localStorage only mirrors small entries).
 */
export async function cachedSearch(query: string): Promise<AxiosResponse> {
  const id = entryId("s", query);
  const hit = await readEntry(id, query);
  if (hit != null) {
    return asAxiosOk("/search", hit);
  }

  const inflightKey = `s:${query}`;
  const existing = inflight.get(inflightKey);
  if (existing) return existing;

  const request = api
    .get("/search", { params: { q: query } })
    .then(async (response) => {
      if (response.status === 200 && isNonEmptySearch(response.data)) {
        await writeEntry(id, query, response.data);
      }
      return response;
    })
    .finally(() => {
      inflight.delete(inflightKey);
    });

  inflight.set(inflightKey, request);
  return request;
}

/** Cached GET for /metadata and /article/*. */
export async function cachedGet(
  url: string,
  reqConfig?: AxiosRequestConfig,
): Promise<AxiosResponse> {
  const path = url.split("?")[0];
  const isMeta = path === "/metadata";
  const isArticle = path.startsWith("/article/");
  if (!isMeta && !isArticle) {
    return api.get(url, reqConfig);
  }

  const kind = isMeta ? "metadata" : "article";
  const logicalKey = isMeta ? "metadata" : path;
  const id = entryId(kind, logicalKey);
  const hit = await readEntry(id, logicalKey);
  if (hit != null) {
    return asAxiosOk(url, hit, reqConfig);
  }

  const existing = inflight.get(id);
  if (existing) return existing;

  const request = api
    .get(url, reqConfig)
    .then(async (response) => {
      const ok =
        response.status === 200 &&
        (isMeta
          ? isNonEmptyMetadata(response.data)
          : isNonEmptyArticle(response.data));
      if (ok) await writeEntry(id, logicalKey, response.data);
      return response;
    })
    .finally(() => {
      inflight.delete(id);
    });

  inflight.set(id, request);
  return request;
}
