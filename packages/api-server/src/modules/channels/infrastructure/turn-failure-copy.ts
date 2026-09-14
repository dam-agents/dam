import type { AcpTurnAbandonedError } from "../../../core/acp-client.js";

export function turnFailureUserCopy(err: AcpTurnAbandonedError): string {
  switch (err.abandonCause) {
    case "connection-lost":
      return (
        "I lost contact with the agent while it was working. It may still " +
        "finish — if its answer doesn't appear here, mention it again: its " +
        "progress is saved and it will pick up where it left off."
      );
    case "ceiling":
      return (
        "The agent was cut off while still working and didn't finish. " +
        "Mention it again to have it pick up where it left off — its " +
        "progress is saved."
      );
  }
}

export function turnFailureReasonToken(err: AcpTurnAbandonedError): string {
  switch (err.abandonCause) {
    case "connection-lost":
      return "relay-lost";
    case "ceiling":
      return "turn-stalled";
  }
}
