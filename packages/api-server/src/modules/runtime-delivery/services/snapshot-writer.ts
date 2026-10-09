import type { HarnessConfigSnapshotPatch } from "api-server-api";

export interface HarnessConfigSnapshotWriter {
  merge(
    agentId: string,
    patch: HarnessConfigSnapshotPatch,
    opts: { confirmed: boolean; harness?: string },
  ): Promise<void>;
}
