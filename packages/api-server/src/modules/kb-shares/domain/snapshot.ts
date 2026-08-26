import { randomBytes } from "node:crypto";
import type { KbPublishFailure } from "agent-runtime-api/kb-snapshot";

export const STALE_SNAPSHOT_GRACE_MS = 60 * 60 * 1000;

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

export function blobKey(shareId: string, contentHash: string): string {
  return `kb-snapshots/${shareId}/blobs/${contentHash}`;
}

export function segmentKey(shareId: string, contentId: string): string {
  return `kb-snapshots/${shareId}/seg/${contentId}`;
}

export class PublishFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishFailure";
  }
}

export function publishFailureMessage(
  failure: KbPublishFailure,
  limits: { maxFiles: number; totalMaxBytes: number; maxWalkDepth: number },
): string {
  switch (failure.code) {
    case "root-missing":
      return `share root "${failure.root}" was not found in the workspace — remove it from the share or create it`;
    case "too-deep":
      return `the share tree is deeper than ${limits.maxWalkDepth} levels — narrow the share roots or remove any directory cycle`;
    case "too-many-files":
      return `the share contains more than ${limits.maxFiles} files — narrow the share roots`;
    case "total-too-large":
      return `the share exceeds ${Math.floor(limits.totalMaxBytes / (1024 * 1024))} MB of text content — narrow the share roots`;
    case "upload-failed":
      return "publishing could not upload the snapshot — retry shortly";
  }
}
