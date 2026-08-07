/** Whether a thrown send needs reporting, and in what words. */
export type SendOutcome = { report: false } | { report: true; message: string };

export interface SendFailureFacts {
  /** The socket went away, rather than the agent answering with a failure. */
  connectionClosed: boolean;
  /** The prompt reached an open socket before the error hit. */
  delivered: boolean;
  /** The prompt was parked behind a still-running turn. */
  queued: boolean;
  /** What the thrown error says — used for anything not classified here. */
  errorMessage: string;
}

const UNDELIVERED_CLOSE_MESSAGE =
  "Couldn't send — the connection to the agent dropped before the message was delivered.";

const QUEUED_LOST_MESSAGE =
  "Couldn't send — the message was still waiting behind the previous turn when the connection dropped.";

/** What a send's rejection means, which turns on *when* the socket died. Once the
 *  prompt has been forwarded the runtime keeps the turn running without its
 *  channel, so a drop after that point costs nothing but the live view and
 *  reporting it would teach the user to distrust a working system. A drop before
 *  delivery is a real loss, though the SDK's wording for it describes our
 *  plumbing rather than their situation. A queued prompt is the exception: the
 *  runtime discards a detaching channel's queue, so that one never runs — its
 *  text still survives in the session log, which is why the copy says the
 *  message wasn't sent rather than that it is gone. */
export function classifySendOutcome(facts: SendFailureFacts): SendOutcome {
  if (!facts.connectionClosed) {
    return { report: true, message: facts.errorMessage };
  }
  if (!facts.delivered) {
    return { report: true, message: UNDELIVERED_CLOSE_MESSAGE };
  }
  if (facts.queued) {
    return { report: true, message: QUEUED_LOST_MESSAGE };
  }
  return { report: false };
}
