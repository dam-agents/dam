/** Whether a thrown send is a failure the user needs to hear about, and in
 *  what words. */
export type SendOutcome = { report: false } | { report: true; message: string };

export interface SendFailureFacts {
  /** The socket went away mid-request, rather than the agent answering with a
   *  failure. */
  connectionClosed: boolean;
  /** `session/prompt` had already been written to the socket when the error
   *  hit. The SDK's prompt call writes its frame on invocation and resolves
   *  only at end of turn, so "delivered" and "finished" are far apart. */
  delivered: boolean;
  /** The prompt was parked behind a still-running turn. */
  queued: boolean;
  /** What the thrown error says — used for anything not classified here. */
  errorMessage: string;
}

export const UNDELIVERED_CLOSE_MESSAGE =
  "Couldn't send — the connection to the agent dropped before the message was delivered.";

export const QUEUED_LOST_MESSAGE =
  "Couldn't send — the message was still waiting behind the previous turn when the connection dropped.";

/**
 * Decide what a send's rejection means.
 *
 * The load-bearing distinction is *when* the socket died. A connection that
 * drops after the prompt frame is on the wire has not lost anything: the
 * runtime keeps an already-forwarded prompt running when its channel detaches,
 * the agent finishes the turn, and history replay carries the reply back. That
 * is what leaving a session mid-turn looks like from here, and reporting it as
 * a failure trains the user to distrust a working system.
 *
 * A drop *before* delivery is a real loss, but the SDK's wording for it
 * ("Connection closed while request was in flight") describes our plumbing
 * rather than the user's situation, so it gets replaced.
 *
 * The exception is a prompt still queued behind another turn: the runtime drops
 * a detaching channel's queued prompts, so for that one the close genuinely
 * loses the message even though it was delivered.
 */
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
