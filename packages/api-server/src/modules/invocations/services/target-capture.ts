import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";
import type { DelegationFramesPort } from "./delegation-frames.js";

const CAPTURE_BUDGET_MS = 20_000;

export interface TargetCapture {
  capture(row: { id: string }): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: copies a target's conversation onto its root
 * driver's volume before the target is deleted. Never throws, never exceeds its
 * budget, and never wakes the root: a root that is not up, a target that does
 * not answer, or a write that fails leaves the record without a conversation.
 */
export function createTargetCapture(deps: {
  repo: InvocationsRepository;
  frames: DelegationFramesPort;
}): TargetCapture {
  async function run(id: string): Promise<void> {
    const row = await deps.repo.get(id);
    if (row === null) return;
    const read = await deps.frames.readFromTarget(id);
    if (read === null || read.frames.length === 0) return;
    const stored = await deps.frames.storeOnRoot(
      row.rootDriverId,
      id,
      read.frames,
    );
    if (stored === null) return;
    await deps.repo.markTranscriptCaptured(
      id,
      read.truncated || stored.truncated,
    );
  }

  return {
    async capture(row) {
      let timer: NodeJS.Timeout | undefined;
      const budget = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), CAPTURE_BUDGET_MS);
        timer.unref();
      });
      try {
        const outcome = await Promise.race([run(row.id), budget]);
        if (outcome === "timeout") {
          process.stderr.write(
            `[invocations] capture ${row.id} exceeded ${CAPTURE_BUDGET_MS}ms\n`,
          );
        }
      } catch (err) {
        process.stderr.write(
          `[invocations] capture ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
