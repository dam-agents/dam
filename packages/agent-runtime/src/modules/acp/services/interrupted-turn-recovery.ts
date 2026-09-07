import type { ActiveTurnStore } from "../infrastructure/active-turn-store.js";
import type { SessionMetadataStore } from "../infrastructure/session-metadata-store.js";
import type { TriggerSessionDriver } from "./trigger-session-driver.js";

const INTERRUPTION_NOTICE = [
  "<turn-interrupted>",
  "Your previous turn here was cut short: the sandbox ran out of memory and " +
    "restarted mid-task. Some effects of your last actions may be partial — " +
    "a file half-written, a command that never finished.",
  "Check the current state of the workspace before you continue, then carry " +
    "on with the task you were working on.",
  "</turn-interrupted>",
].join("\n");

/**
 * UNIT_BOUNDARY_DESCRIPTION: On boot, resumes every Session whose turn an
 * abnormal pod death interrupted, so work continues unattended instead of
 * silently stopping until someone notices — a scheduled fire and a person's
 * chat alike. It reads the leftover Active-Turn markers and, for each still on
 * its first attempt and not deleted, resumes the Session through the Trigger
 * Session Driver with an injected interruption notice as the prompt; the
 * running harness picks the resumed turn up the way it would a message sent
 * mid-task. The attempt is counted before the resume is tried, so a
 * continuation that runs out of memory again cannot crash-loop the pod. This is
 * not the no-auto-resend case: an Active-Turn marker is written only once the
 * harness has *taken* the prompt, so resuming continues a turn the agent
 * already saw — it never re-sends a queued prompt the agent never received
 * (those live in the undelivered-prompts document and stay user-initiated).
 */
export async function recoverInterruptedTurns(deps: {
  store: ActiveTurnStore;
  sessionMetadata: SessionMetadataStore;
  triggerDriver: TriggerSessionDriver;
  log: (msg: string) => void;
}): Promise<void> {
  for (const marker of deps.store.leftovers()) {
    if (marker.attempts > 0) {
      deps.log(
        `not resuming ${marker.sessionId}: already attempted ${String(marker.attempts)}x`,
      );
      continue;
    }
    if (deps.sessionMetadata.isTombstoned(marker.sessionId)) {
      deps.store.remove(marker.sessionId);
      continue;
    }
    deps.store.bumpAttempts(marker.sessionId);
    try {
      await deps.triggerDriver.start({
        task: INTERRUPTION_NOTICE,
        resumeSessionId: marker.sessionId,
      });
      deps.log(`resumed interrupted session ${marker.sessionId}`);
    } catch (err) {
      deps.log(
        `failed to resume ${marker.sessionId}: ${(err as Error).message}`,
      );
    }
  }
}
