import { z } from "zod";

export const MANIFEST_VERSION = 2;

export interface SnapshotManifestFile {
  path: string;
  sizeBytes: number;
  contentHash: string;
  key: string;
}

export interface SnapshotSearchSegment {
  bucket: number;
  key: string;
  contentId: string;
  docCount: number;
  sizeBytes: number;
  degraded: boolean;
}

export interface SnapshotSearch {
  formatVersion: number;
  bucketCount: number;
  segments: SnapshotSearchSegment[];
}

export interface SnapshotManifest {
  version: 2;
  snapshotId: string;
  createdAt: string;
  roots: readonly string[];
  files: SnapshotManifestFile[];
  documentCount: number;
  totalSizeBytes: number;
  search: SnapshotSearch | null;
}

export interface LegacySnapshotManifestV1 {
  version: 1;
  snapshotId: string;
  createdAt: string;
  roots: readonly string[];
  files: SnapshotManifestFile[];
  documentCount: number;
  totalSizeBytes: number;
  searchIndexKey?: string;
  searchDegraded?: boolean;
}

export type AnySnapshotManifest = SnapshotManifest | LegacySnapshotManifestV1;

const manifestFileSchema = z.object({
  path: z.string(),
  sizeBytes: z.number(),
  contentHash: z.string(),
  key: z.string(),
});

const manifestV1Schema = z.object({
  version: z.literal(1),
  snapshotId: z.string(),
  createdAt: z.string(),
  roots: z.array(z.string()),
  files: z.array(manifestFileSchema),
  documentCount: z.number(),
  totalSizeBytes: z.number(),
  searchIndexKey: z.string().optional(),
  searchDegraded: z.boolean().optional(),
});

const manifestV2Schema = z.object({
  version: z.literal(2),
  snapshotId: z.string(),
  createdAt: z.string(),
  roots: z.array(z.string()),
  files: z.array(manifestFileSchema),
  documentCount: z.number(),
  totalSizeBytes: z.number(),
  search: z
    .object({
      formatVersion: z.number().int(),
      bucketCount: z.number().int().positive(),
      segments: z.array(
        z.object({
          bucket: z.number().int(),
          key: z.string(),
          contentId: z.string(),
          docCount: z.number().int(),
          sizeBytes: z.number().int(),
          degraded: z.boolean(),
        }),
      ),
    })
    .nullable(),
});

const anyManifestSchema = z.discriminatedUnion("version", [
  manifestV1Schema,
  manifestV2Schema,
]);

export function parseManifest(raw: string): AnySnapshotManifest | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = anyManifestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
