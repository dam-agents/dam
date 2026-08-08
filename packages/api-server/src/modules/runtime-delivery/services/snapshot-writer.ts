import type { HarnessConfigSnapshotPatch } from "api-server-api";

/**
 * What the delivery path needs of the harness-config snapshot, declared here so
 * runtime-delivery never reaches into the harness-config module. Satisfied at
 * the composition root by that module's repository.
 *
 * `hello` and the apply result are the two moments a pod tells us what its
 * config file actually says, which is the only way the snapshot converges after
 * a hand-edit — the `harness-config` event writes once and never re-asserts.
 */
export interface HarnessConfigSnapshotWriter {
  merge(
    agentId: string,
    patch: HarnessConfigSnapshotPatch,
    opts: { confirmed: boolean },
  ): Promise<void>;
}
