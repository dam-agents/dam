import type { ArtifactService } from "../../artifacts/services/artifact-service.js";
import { parseSearchIndex, type SearchIndex } from "../domain/search-index.js";
import { parseManifest, type SnapshotManifest } from "../domain/snapshot.js";

const MANIFEST_CACHE_BUDGET_BYTES = 16 * 1024 * 1024;
const GUIDE_FILE_NAME = "USAGE_GUIDE.md";
const GUIDE_MAX_CHARS = 8000;
export const READ_DEFAULT_MAX_CHARS = 200_000;

export interface DocumentSlice {
  content: string;
  totalChars: number;
  truncated: boolean;
}

export interface SnapshotReader {
  getManifest(
    manifestKey: string,
    snapshotId: string,
  ): Promise<SnapshotManifest | null>;
  getSearchIndex(manifest: SnapshotManifest): Promise<SearchIndex | null>;
  readDocument(
    manifest: SnapshotManifest,
    path: string,
    opts?: { offset?: number; maxChars?: number },
  ): Promise<DocumentSlice | null>;
  readDocumentText(
    manifest: SnapshotManifest,
    path: string,
  ): Promise<string | null>;
  readGuide(manifest: SnapshotManifest): Promise<string | null>;
}

interface CachedEntry {
  value: SnapshotManifest | SearchIndex;
  bytes: number;
}

export function createSnapshotReader(
  store: Pick<ArtifactService, "get">,
): SnapshotReader {
  const cache = new Map<string, CachedEntry>();
  let cachedBytes = 0;

  function remember(cacheKey: string, entry: CachedEntry): void {
    const prev = cache.get(cacheKey);
    if (prev) cachedBytes -= prev.bytes;
    cache.delete(cacheKey);
    cache.set(cacheKey, entry);
    cachedBytes += entry.bytes;
    for (const [key, value] of cache) {
      if (cachedBytes <= MANIFEST_CACHE_BUDGET_BYTES) break;
      cache.delete(key);
      cachedBytes -= value.bytes;
    }
  }

  function recall(cacheKey: string): SnapshotManifest | SearchIndex | null {
    const entry = cache.get(cacheKey);
    if (!entry) return null;
    cache.delete(cacheKey);
    cache.set(cacheKey, entry);
    return entry.value;
  }

  async function readManifestEntryText(
    manifest: SnapshotManifest,
    path: string,
  ): Promise<string | null> {
    const file = manifest.files.find((f) => f.path === path);
    if (!file) return null;
    const stored = await store.get(file.key);
    if (!stored) return null;
    return stored.content.toString("utf8");
  }

  return {
    async getManifest(manifestKey, snapshotId) {
      const cached = recall(`m:${snapshotId}`);
      if (cached) return cached as SnapshotManifest;
      const stored = await store.get(manifestKey);
      if (!stored) return null;
      const raw = stored.content.toString("utf8");
      const manifest = parseManifest(raw);
      if (!manifest || manifest.snapshotId !== snapshotId) return null;
      remember(`m:${snapshotId}`, { value: manifest, bytes: raw.length });
      return manifest;
    },

    async getSearchIndex(manifest) {
      if (!manifest.searchIndexKey) return null;
      const cached = recall(`i:${manifest.snapshotId}`);
      if (cached) return cached as SearchIndex;
      const stored = await store.get(manifest.searchIndexKey);
      if (!stored) return null;
      const raw = stored.content.toString("utf8");
      const index = parseSearchIndex(raw);
      if (!index) return null;
      remember(`i:${manifest.snapshotId}`, { value: index, bytes: raw.length });
      return index;
    },

    async readDocumentText(manifest, path) {
      return readManifestEntryText(manifest, path);
    },

    async readDocument(manifest, path, opts) {
      const text = await readManifestEntryText(manifest, path);
      if (text === null) return null;
      const offset = Math.max(0, opts?.offset ?? 0);
      const maxChars = Math.min(
        Math.max(1, opts?.maxChars ?? READ_DEFAULT_MAX_CHARS),
        READ_DEFAULT_MAX_CHARS,
      );
      const content = text.slice(offset, offset + maxChars);
      return {
        content,
        totalChars: text.length,
        truncated: offset + content.length < text.length,
      };
    },

    async readGuide(manifest) {
      for (const root of manifest.roots) {
        const text = await readManifestEntryText(
          manifest,
          `${root}/${GUIDE_FILE_NAME}`,
        );
        if (text !== null) return text.slice(0, GUIDE_MAX_CHARS);
      }
      return null;
    },
  };
}
