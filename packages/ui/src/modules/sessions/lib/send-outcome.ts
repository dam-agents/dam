import { QUEUE_FULL_DESCRIPTION } from "../../acp/errors.js";

export type SendOutcome = { report: false } | { report: true; message: string };

export interface SendFailureFacts {
  connectionClosed: boolean;
  delivered: boolean;
  queued: boolean;
  queueFull: boolean;
  closeReason: string | null;
  errorMessage: string;
}

const UNDELIVERED_CLOSE_MESSAGE =
  "Couldn't send — the connection to the agent dropped before the message was delivered.";

function undelivered(closeReason: string | null): string {
  return closeReason
    ? `${UNDELIVERED_CLOSE_MESSAGE} Reason: ${closeReason}.`
    : UNDELIVERED_CLOSE_MESSAGE;
}

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
  return { report: false };
}
