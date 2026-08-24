import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const MANIFEST_VERSION = 1;
export const PER_FILE_MAX_BYTES = 2 * 1024 * 1024;
export const TOTAL_MAX_BYTES = 200 * 1024 * 1024;
export const MAX_FILES = 5000;
export const STALE_SNAPSHOT_GRACE_MS = 60 * 60 * 1000;

const TEXT_EXTENSIONS = new Set([
  "md",
  "markdown",
  "txt",
  "text",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "csv",
  "tsv",
  "html",
  "htm",
  "css",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "c",
  "h",
  "cpp",
  "hpp",
  "sh",
  "bash",
  "zsh",
  "sql",
  "xml",
  "svg",
  "ini",
  "cfg",
  "conf",
  "rst",
  "adoc",
  "tex",
  "bib",
  "mermaid",
]);

export interface SnapshotManifestFile {
  path: string;
  sizeBytes: number;
  contentHash: string;
  key: string;
}

export interface SnapshotManifest {
  version: number;
  snapshotId: string;
  createdAt: string;
  roots: readonly string[];
  files: SnapshotManifestFile[];
  documentCount: number;
  totalSizeBytes: number;
  searchIndexKey?: string;
  searchDegraded?: boolean;
}

export interface StaleSnapshotEntry {
  snapshotId: string;
  manifestKey: string;
  replacedAt: string;
}

export function mintSnapshotId(): string {
  return randomBytes(8).toString("hex");
}

export function manifestKey(shareId: string, snapshotId: string): string {
  return `kb-snapshots/${shareId}/${snapshotId}/manifest.json`;
}

export function fileObjectKey(
  shareId: string,
  snapshotId: string,
  path: string,
): string {
  const pathDigest = createHash("sha256").update(path).digest("hex");
  return `kb-snapshots/${shareId}/${snapshotId}/f/${pathDigest.slice(0, 24)}`;
}

export function contentHash(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function shouldConsiderFileName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return true;
  const extension = name.slice(dot + 1).toLowerCase();
  return TEXT_EXTENSIONS.has(extension);
}

export class PublishFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishFailure";
  }
}

const manifestSchema = z.object({
  version: z.literal(MANIFEST_VERSION),
  snapshotId: z.string(),
  createdAt: z.string(),
  roots: z.array(z.string()),
  files: z.array(
    z.object({
      path: z.string(),
      sizeBytes: z.number(),
      contentHash: z.string(),
      key: z.string(),
    }),
  ),
  documentCount: z.number(),
  totalSizeBytes: z.number(),
  searchIndexKey: z.string().optional(),
  searchDegraded: z.boolean().optional(),
});

export function parseManifest(raw: string): SnapshotManifest | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = manifestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
