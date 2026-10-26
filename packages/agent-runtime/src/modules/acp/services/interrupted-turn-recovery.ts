import { SessionType, type PlatformUndeliveredPrompt } from "api-server-api";
import type { ActiveTurnStore } from "../infrastructure/active-turn-store.js";
import type { SessionMetadataStore } from "../infrastructure/session-metadata-store.js";
import type { TriggerSessionDriver } from "./trigger-session-driver.js";

const DISOWNED_REJECTION =
  "The tool call that was running when the sandbox went down may show in " +
  'your history as rejected or interrupted by the user — "The user ' +
  'doesn\'t want to proceed with this tool use", "[Request interrupted ' +
  'by user for tool use]". Nobody rejected it: the restart cut it off, ' +
  "and the harness records that as a rejection. Do not stop or wait for " +
  "the user because of it.";
const CHECK_AND_CONTINUE =
  "Check the current state of the workspace before you continue, then carry " +
  "on with the task you were working on.";

export const INTERRUPTION_NOTICE = [
  "<turn-interrupted>",
  "Your previous turn here was cut short: the sandbox restarted mid-task " +
    "(most often because it ran out of memory). Some effects of your last " +
    "actions may be partial — a file half-written, a command that never " +
    "finished.",
  DISOWNED_REJECTION,
  CHECK_AND_CONTINUE,
  "If this problem persists, stop and tell the user that only a platform " +
    "operator can raise their memory budget.",
  "</turn-interrupted>",
].join("\n");

export const STOPPED_NOTICE = [
  "<turn-interrupted>",
  "Your previous turn here was cut short: the platform stopped the sandbox " +
    "mid-task — the agent was put to sleep, restarted or moved — and it has " +
    "started again. Some effects of your last actions may be partial — a " +
    "file half-written, a command that never finished.",
  DISOWNED_REJECTION,
  CHECK_AND_CONTINUE,
  "</turn-interrupted>",
].join("\n");

export const MAX_RESUME_ATTEMPTS = 5;

const SCHEDULED_SESSION_TYPES: readonly string[] = [
  SessionType.ScheduleCron,
  SessionType.ScheduleOnce,
];

function promptText(prompt: PlatformUndeliveredPrompt): string {
  return prompt.blocks
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n\n");
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: On boot, resumes every Session whose turn an
 * abnormal death interrupted, so work continues unattended instead of
 * silently stopping until someone notices — a scheduled fire and a person's
 * chat alike. It reads the leftover Active-Turn markers and, for each with
 * attempts left and not deleted, resumes the Session through the Trigger
 * Session Driver with an injected interruption notice as the prompt; the
 * running harness picks the resumed turn up the way it would a message sent
 * mid-task. The notice also disowns the harness's record of the tool call the
 * restart cut off — written as a user's rejection that says to stop and wait —
 * so the agent carries on instead of waiting for a person who never acted.
 * A turn the platform stopped, as by a Sleep, gets a notice that says so
 * rather than blaming its memory. Nobody reads the resumed turn live, so its
 * prompt waits for the harness alone, never for a viewer to engage.
 * A continuation that dies again is resumed again, up to
 * MAX_RESUME_ATTEMPTS times for one interruption. The attempt is counted before
 * the resume is tried, so a continuation that keeps running out of memory
 * cannot crash-loop the machine. This is
 * not the no-auto-resend case: an Active-Turn marker is written only once the
 * harness has *taken* the prompt, so resuming continues a turn the agent
 * already saw — it never re-sends a queued prompt the agent never received
 * (those live in the undelivered-prompts document and stay user-initiated).
 * Each marker is looked up again just before its own resume, because resuming
 * the ones before it takes time, and a Session a person starts using in that
 * window belongs to their turn, not to recovery.
 * A scheduled Session the harness never stored cannot be resumed at all — the
 * harness has no such conversation — so the task its marker kept runs again in
 * a fresh unattended Session of the same schedule instead. That is how a fire
 * whose machine went down on its first turn still does its work, where the
 * person who would otherwise retry it never exists.
 */
export async function recoverInterruptedTurns(deps: {
  store: ActiveTurnStore;
  sessionMetadata: SessionMetadataStore;
  triggerDriver: TriggerSessionDriver;
  bindScheduleSession?: (scheduleId: string, sessionId: string) => void;
  log: (msg: string) => void;
}): Promise<void> {
  for (const { sessionId } of deps.store.leftovers()) {
    const marker = deps.store
      .leftovers()
      .find((m) => m.sessionId === sessionId);
    if (marker === undefined) {
      deps.log(`not resuming ${sessionId}: a live turn took it over`);
      continue;
    }
    if (marker.attempts >= MAX_RESUME_ATTEMPTS) {
      deps.log(
        `not resuming ${marker.sessionId}: already attempted ${String(marker.attempts)}x`,
      );
      continue;
    }
    if (deps.sessionMetadata.isTombstoned(marker.sessionId)) {
      deps.store.remove(marker.sessionId);
      continue;
    }
    const entry = deps.sessionMetadata.get(marker.sessionId);
    const task = marker.prompt ? promptText(marker.prompt) : "";
    if (
      entry?.unstored === true &&
      task !== "" &&
      SCHEDULED_SESSION_TYPES.includes(entry.meta.type ?? "")
    ) {
      deps.store.bumpAttempts(marker.sessionId);
      try {
        const { sessionId: rerun } = await deps.triggerDriver.start({
          task,
          platformMeta: entry.meta,
          unattended: true,
        });
        deps.sessionMetadata.tombstone(marker.sessionId);
        deps.store.remove(marker.sessionId);
        if (entry.meta.scheduleId)
          deps.bindScheduleSession?.(entry.meta.scheduleId, rerun);
        deps.log(
          `ran the cut first turn of ${marker.sessionId} again in ${rerun}`,
        );
      } catch (err) {
        deps.log(
          `failed to re-run the cut first turn of ${marker.sessionId}: ${(err as Error).message}`,
        );
      }
      continue;
    }
    deps.store.bumpAttempts(marker.sessionId);
    try {
      await deps.triggerDriver.start({
        task: marker.stopped ? STOPPED_NOTICE : INTERRUPTION_NOTICE,
        resumeSessionId: marker.sessionId,
        unattended: true,
      });
      deps.log(`resumed interrupted session ${marker.sessionId}`);
    } catch (err) {
      deps.store.remove(marker.sessionId);
      deps.log(
        `failed to resume ${marker.sessionId}, gave up: ${(err as Error).message}`,
      );
    }
  }
}
