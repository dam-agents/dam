import { QUEUE_FULL_DESCRIPTION } from "../../acp/errors.js";
import { QUEUED_LOST_MESSAGE } from "../../acp/session-projection.js";

/** Whether a thrown send needs reporting, and in what words. */
export type SendOutcome = { report: false } | { report: true; message: string };

export interface SendFailureFacts {
  /** The socket went away, rather than the agent answering with a failure. */
  connectionClosed: boolean;
  /** The prompt reached an open socket before the error hit. */
  delivered: boolean;
  /** The prompt was parked behind a still-running turn. */
  queued: boolean;
  /** The session's prompt queue is at capacity. */
  queueFull: boolean;
  /** Why the socket closed, when it said. */
  closeReason: string | null;
  /** What the thrown error says — used for anything not classified here. */
  errorMessage: string;
}

const UNDELIVERED_CLOSE_MESSAGE =
  "Couldn't send — the connection to the agent dropped before the message was delivered.";

function undelivered(closeReason: string | null): string {
  return closeReason
    ? `${UNDELIVERED_CLOSE_MESSAGE} Reason: ${closeReason}.`
    : UNDELIVERED_CLOSE_MESSAGE;
}

/** What a send's rejection means, which turns on *when* the socket died. Once the
 *  prompt has been forwarded the runtime keeps the turn running without its
 *  channel, so a drop after that point costs nothing but the live view and
 *  reporting it would teach the user to distrust a working system. A drop before
 *  delivery is a real loss, though the SDK's wording for it describes our
 *  plumbing rather than their situation, so the socket's own reason is carried
 *  through when it gave one — unattributed, because the relay writes it as
 *  often as the runtime does. A queued prompt is the exception: the runtime
 *  discards a detaching channel's queue, so that one never runs — it fails in
 *  the WS close handler's exact words (`QUEUED_LOST_MESSAGE`), because this
 *  rejection and that handler race in either order and must agree. */
export function classifySendOutcome(facts: SendFailureFacts): SendOutcome {
  if (facts.queueFull) {
    return { report: true, message: QUEUE_FULL_DESCRIPTION.message };
  }
  if (!facts.connectionClosed) {
    return { report: true, message: facts.errorMessage };
  }
  if (!facts.delivered) {
    return { report: true, message: undelivered(facts.closeReason) };
  }
  if (facts.queued) {
    return { report: true, message: QUEUED_LOST_MESSAGE };
  }
  return { report: false };
}
