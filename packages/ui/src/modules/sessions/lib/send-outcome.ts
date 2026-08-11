import { isAgentStopCloseReason } from "api-server-api";

import { QUEUE_FULL_DESCRIPTION } from "../../acp/errors.js";
import { QUEUED_LOST_MESSAGE } from "../../acp/session-projection.js";

/** Whether a thrown send needs reporting, in what words, and whether Retry is
 *  worth offering — a conversation the agent no longer has cannot be retried
 *  into. */
export type SendOutcome =
  | { report: false }
  | { report: true; message: string; retry: boolean };

export interface SendFailureFacts {
  /** The socket went away, rather than the agent answering with a failure. */
  connectionClosed: boolean;
  /** The prompt reached an open socket before the error hit. */
  delivered: boolean;
  /** The prompt was parked behind a still-running turn. */
  queued: boolean;
  /** The agent says it has no such session. */
  sessionMissing: boolean;
  /** The session's prompt queue is at capacity. */
  queueFull: boolean;
  /** Why the socket closed, when it said. */
  closeReason: string | null;
  /** What the thrown error says — used for anything not classified here. */
  errorMessage: string;
}

const UNDELIVERED_CLOSE_MESSAGE =
  "Couldn't send — the connection to the agent dropped before the message was delivered.";

const SESSION_MISSING_MESSAGE =
  "Couldn't send — the agent no longer has this conversation. It may have been deleted, or the agent restarted without it. Start a new conversation to carry on.";

function undelivered(closeReason: string | null): string {
  return closeReason
    ? `${UNDELIVERED_CLOSE_MESSAGE} The agent reported: ${closeReason}.`
    : UNDELIVERED_CLOSE_MESSAGE;
}

function agentStopped(closeReason: string): string {
  return `The agent stopped before answering, so this turn was lost. The agent reported: ${closeReason}.`;
}

/** What a send's rejection means, which turns on *when* the socket died. Once the
 *  prompt has been forwarded the runtime keeps the turn running without its
 *  channel, so a drop after that point usually costs nothing but the live view
 *  and reporting it would teach the user to distrust a working system — unless
 *  the reason names an agent-side stop: the runtime closes an engaged channel
 *  that way when the agent exits, is recycled, or was never running, and none
 *  of those turns survives to be replayed. Any other reason, including the text
 *  a relay substitutes when the upstream gave none, stands for a reasonless
 *  close. A drop before delivery is a real loss
 *  either way, though the SDK's wording for it describes our plumbing rather
 *  than their situation, so the socket's own reason is carried through. A queued
 *  prompt is the exception: the runtime discards a detaching channel's queue, so
 *  that one never runs — it fails in the WS close handler's exact words
 *  (`QUEUED_LOST_MESSAGE`), because this rejection and that handler race in
 *  either order and must agree. */
export function classifySendOutcome(facts: SendFailureFacts): SendOutcome {
  if (facts.sessionMissing) {
    return { report: true, message: SESSION_MISSING_MESSAGE, retry: false };
  }
  if (facts.queueFull) {
    return {
      report: true,
      message: QUEUE_FULL_DESCRIPTION.message,
      retry: true,
    };
  }
  if (!facts.connectionClosed) {
    return { report: true, message: facts.errorMessage, retry: true };
  }
  if (!facts.delivered) {
    return {
      report: true,
      message: undelivered(facts.closeReason),
      retry: true,
    };
  }
  if (facts.queued) {
    return { report: true, message: QUEUED_LOST_MESSAGE, retry: true };
  }
  if (isAgentStopCloseReason(facts.closeReason)) {
    return {
      report: true,
      message: agentStopped(facts.closeReason),
      retry: true,
    };
  }
  return { report: false };
}
