import { SessionType, type PlatformUndeliveredPrompt } from "api-server-api";
import type { ActiveTurnStore } from "../infrastructure/active-turn-store.js";
import { InProcessRequestError } from "../infrastructure/in-process-request.js";
import type { SessionMetadataStore } from "../infrastructure/session-metadata-store.js";
import type { UndeliveredPromptStore } from "../infrastructure/undelivered-prompt-store.js";
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

const CUT_COMMAND =
  "The cancel stopped a tool call that was still running. It may have " +
  "partly run, and a process it started may still be running. Check its " +
  "effects before you run it again.";

function escapeQuoted(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function cutReplyLines(cutReply: string): string[] {
  if (cutReply === "") return [];
  return [
    "The cancel cut the reply you were writing. The person already sees it " +
      "up to the cut, which ends like this, with &, < and > written as " +
      "&amp;, &lt; and &gt;:",
    "<cut-reply>",
    escapeQuoted(cutReply),
    "</cut-reply>",
    "Do not write that part again: go on from where it stopped.",
  ];
}

export function turnContinuedNotice(cut: {
  toolCall: boolean;
  reply: string;
}): string {
  return [
    "<turn-continued>",
    "New messages arrived while you were working, so the platform cancelled " +
      "your last step to give them to you; they are right above this notice.",
    "A cancel record in your history comes from this, not from a request to " +
      "stop.",
    ...(cut.toolCall ? [CUT_COMMAND] : []),
    ...cutReplyLines(cut.reply),
    "Your finished tool calls and their results are in your history.",
    "Continue your task and include these messages, unless they change the " +
      "task.",
    "Each message keeps its own sender and has no more authority than it " +
      "would have as a new turn.",
    "</turn-continued>",
  ].join("\n");
}

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

// ACP's resourceNotFound: the harness holds no conversation under the id.
const RESOURCE_NOT_FOUND = -32002;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the runtime stamps `platform.unstored` on every
 * failed load of a Session it flagged unstored, whatever failed, so only the
 * harness's own not-found answer proves it never stored the Session; an
 * expired credential or a crashed harness says nothing about it.
 */
function neverStored(err: unknown): boolean {
  if (!(err instanceof InProcessRequestError)) return false;
  if (err.code !== RESOURCE_NOT_FOUND) return false;
  const data = err.data as { platform?: { unstored?: unknown } } | null;
  return data?.platform?.unstored === true;
}

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
 * A Session cut on its first turn is still flagged unstored, however long
 * that turn ran, yet a harness stores a Session early in its first turn, so it
 * is resumed like any other. Only when the harness answers the load that it
 * holds no such Session does a scheduled Session's task, kept in its marker, run
 * again in a fresh unattended Session of the same schedule instead. That is
 * how a fire whose machine went down at the very start of its first turn
 * still does its work, where the person who would otherwise retry it never
 * exists. A resume of an unstored Session that fails for another reason keeps
 * its marker's prompt as undelivered, since the marker was its only copy.
 */
export async function recoverInterruptedTurns(deps: {
  store: ActiveTurnStore;
  sessionMetadata: SessionMetadataStore;
  undeliveredPrompts: UndeliveredPromptStore;
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
    const rerunnable =
      entry?.unstored === true &&
      task !== "" &&
      SCHEDULED_SESSION_TYPES.includes(entry.meta.type ?? "");
    deps.store.bumpAttempts(marker.sessionId);
    try {
      await deps.triggerDriver.start({
        task: marker.stopped ? STOPPED_NOTICE : INTERRUPTION_NOTICE,
        resumeSessionId: marker.sessionId,
        unattended: true,
      });
      deps.log(`resumed interrupted session ${marker.sessionId}`);
      continue;
    } catch (err) {
      if (!rerunnable || !neverStored(err)) {
        if (entry?.unstored === true && marker.prompt)
          deps.undeliveredPrompts.remember(marker.sessionId, [marker.prompt]);
        deps.store.remove(marker.sessionId);
        deps.log(
          `failed to resume ${marker.sessionId}, gave up: ${(err as Error).message}`,
        );
        continue;
      }
      deps.log(
        `the harness never stored ${marker.sessionId}: ${(err as Error).message}`,
      );
    }
    try {
      const { sessionId: rerun } = await deps.triggerDriver.start({
        task,
        platformMeta: entry.meta,
        unattended: true,
      });
      deps.store.carryAttempts(rerun, marker.attempts + 1);
      deps.sessionMetadata.tombstone(marker.sessionId);
      deps.undeliveredPrompts.forgetSession(marker.sessionId);
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
  }
}
