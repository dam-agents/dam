import type { KbSharePublishState } from "api-server-api";
import type { StaleSnapshotEntry } from "./snapshot.js";

export interface KbShareRow {
  id: string;
  agentId: string;
  owner: string;
  secret: string;
  publicName: string | null;
  roots: readonly string[];
  status: "active" | "revoked";
  snapshotId: string | null;
  snapshotManifestKey: string | null;
  snapshotCreatedAt: Date | null;
  documentCount: number | null;
  totalSizeBytes: number | null;
  publishState: KbSharePublishState;
  publishError: string | null;
  publishToken: string | null;
  staleSnapshots: readonly StaleSnapshotEntry[];
  queryCount: number;
  lastUsedAt: Date | null;
  dirtyAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
