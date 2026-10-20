import type { AcpTurnAbandonedError } from "../../../core/acp-client.js";
import type { NoDefaultModelError } from "../../harness-config/index.js";

export function turnFailureUserCopy(err: AcpTurnAbandonedError): string {
  switch (err.abandonCause) {
    case "connection-lost":
      return (
        "I lost contact with the agent while it was working. It may still " +
        "finish — if its answer doesn't appear here, mention it again: its " +
        "progress is saved and it will pick up where it left off."
      );
    case "stalled":
      return (
        "The agent went quiet partway through and didn't finish. Mention it " +
        "again to have it pick up where it left off — its progress is saved."
      );
  }
}

export function turnFailureReasonToken(err: AcpTurnAbandonedError): string {
  switch (err.abandonCause) {
    case "connection-lost":
      return "relay-lost";
    case "stalled":
      return "turn-stalled";
  }
}

export function noDefaultModelUserCopy(
  err: NoDefaultModelError,
  uiBaseUrl: string,
  agentId: string,
): string {
  return err.pending
    ? "This agent is still setting up its default model after an update. Try again in a minute."
    : `This agent has no default model, so it can't answer here yet. Its owner can set one at ${uiBaseUrl}/sandboxes/${agentId}/providers`;
}
