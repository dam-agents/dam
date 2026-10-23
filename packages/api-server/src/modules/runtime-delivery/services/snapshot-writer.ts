import type { HarnessConfigSnapshotPatch } from "api-server-api";
import type { HarnessConfigCurrent } from "agent-runtime-api";

export interface HarnessConfigSnapshotWriter {
  merge(
    agentId: string,
    patch: HarnessConfigSnapshotPatch,
    opts: { confirmed: boolean; harness?: string },
  ): Promise<void>;
}

export async function mergeReportedSnapshot(
  writer: HarnessConfigSnapshotWriter,
  agentId: string,
  reported: {
    current?: HarnessConfigCurrent;
    byHarness?: Record<string, HarnessConfigCurrent>;
  },
  log: (msg: string) => void,
  tag: string,
): Promise<void> {
  try {
    if (reported.current)
      await writer.merge(agentId, reported.current, { confirmed: true });
    for (const [harness, current] of Object.entries(reported.byHarness ?? {}))
      await writer.merge(agentId, current, { confirmed: true, harness });
  } catch (err) {
    log(
      `${tag} ${agentId}: harness-config snapshot write failed: ${(err as Error).message}`,
    );
  }
}
