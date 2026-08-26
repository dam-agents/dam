import {
  INDEX_FORMAT_VERSION,
  parseManifest,
  parseSegment,
  type AnySnapshotManifest,
  type IndexSegment,
  type LegacySnapshotManifestV1,
} from "agent-runtime-api/kb-snapshot";

import type { ArtifactService } from "../../artifacts/services/artifact-service.js";
import {
  parseSearchIndex,
  type SearchIndex,
} from "../domain/legacy-search-index.js";

const MANIFEST_CACHE_BUDGET_BYTES = 16 * 1024 * 1024;
const GUIDE_FILE_NAME = "USAGE_GUIDE.md";
const GUIDE_MAX_CHARS = 8000;
export const READ_DEFAULT_MAX_CHARS = 200_000;

export interface DocumentSlice {
  content: string;
  totalChars: number;
  truncated: boolean;
}

export type LoadedSearch =
  | { kind: "legacy"; index: SearchIndex }
  | { kind: "segmented"; segments: IndexSegment[]; degraded: boolean }
  | { kind: "none" }
  | { kind: "unreadable"; formatVersion: number };

export interface SnapshotReader {
  getManifest(
    manifestKey: string,
    snapshotId: string,
  ): Promise<AnySnapshotManifest | null>;
  getSearch(manifest: AnySnapshotManifest): Promise<LoadedSearch>;
  readDocument(
    manifest: AnySnapshotManifest,
    path: string,
    opts?: { offset?: number; maxChars?: number },
  ): Promise<DocumentSlice | null>;
  readDocumentText(
    manifest: AnySnapshotManifest,
    path: string,
  ): Promise<string | null>;
  readGuide(manifest: AnySnapshotManifest): Promise<string | null>;
}

interface CachedEntry {
  value: AnySnapshotManifest | SearchIndex | IndexSegment;
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

  function recall(cacheKey: string): CachedEntry["value"] | null {
    const entry = cache.get(cacheKey);
    if (!entry) return null;
    cache.delete(cacheKey);
    cache.set(cacheKey, entry);
    return entry.value;
  }

  async function readManifestEntryText(
    manifest: AnySnapshotManifest,
    path: string,
  ): Promise<string | null> {
    const file = manifest.files.find((f) => f.path === path);
    if (!file) return null;
    const stored = await store.get(file.key);
    if (!stored) return null;
    return stored.content.toString("utf8");
  }

  async function loadLegacyIndex(
    manifest: LegacySnapshotManifestV1,
  ): Promise<LoadedSearch> {
    if (!manifest.searchIndexKey) return { kind: "none" };
    const cached = recall(`i:${manifest.snapshotId}`);
    if (cached) return { kind: "legacy", index: cached as SearchIndex };
    const stored = await store.get(manifest.searchIndexKey);
    if (!stored) return { kind: "none" };
    const raw = stored.content.toString("utf8");
    const index = parseSearchIndex(raw);
    if (!index) return { kind: "none" };
    remember(`i:${manifest.snapshotId}`, { value: index, bytes: raw.length });
    return { kind: "legacy", index };
  }

  return {
    async getManifest(manifestKey, snapshotId) {
      const cached = recall(`m:${snapshotId}`);
      if (cached) return cached as AnySnapshotManifest;
      const stored = await store.get(manifestKey);
      if (!stored) return null;
      const raw = stored.content.toString("utf8");
      const manifest = parseManifest(raw);
      if (!manifest || manifest.snapshotId !== snapshotId) return null;
      remember(`m:${snapshotId}`, { value: manifest, bytes: raw.length });
      return manifest;
    },

    async getSearch(manifest) {
      if (manifest.version === 1) return loadLegacyIndex(manifest);
      const search = manifest.search;
      if (!search || search.segments.length === 0) return { kind: "none" };
      if (search.formatVersion !== INDEX_FORMAT_VERSION) {
        return { kind: "unreadable", formatVersion: search.formatVersion };
      }
      const segments: IndexSegment[] = [];
      for (const entry of search.segments) {
        const cached = recall(`s:${entry.contentId}`);
        if (cached) {
          segments.push(cached as IndexSegment);
          continue;
        }
        const stored = await store.get(entry.key);
        if (!stored) {
          return { kind: "unreadable", formatVersion: search.formatVersion };
        }
        const raw = stored.content.toString("utf8");
        const segment = parseSegment(raw);
        if (!segment) {
          return { kind: "unreadable", formatVersion: search.formatVersion };
        }
        remember(`s:${entry.contentId}`, { value: segment, bytes: raw.length });
        segments.push(segment);
      }
      const degraded = search.segments.some((s) => s.degraded);
      return { kind: "segmented", segments, degraded };
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
