import type { AcpTurnAbandonedError } from "../../../core/acp-client.js";

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
    case "runaway": {
      const limit =
        err.capSeconds !== undefined
          ? `after ${formatHours(err.capSeconds)}`
          : "at its time limit";
      return (
        `I stopped this task ${limit} — it was still running. Its progress ` +
        "is saved; for work this size, try asking for it in parts."
      );
    }
  }
}

export function turnFailureReasonToken(err: AcpTurnAbandonedError): string {
  switch (err.abandonCause) {
    case "connection-lost":
      return "relay-lost";
    case "stalled":
      return "turn-stalled";
    case "runaway":
      return "turn-runaway";
  }
}

function formatHours(seconds: number): string {
  const hours = seconds / 3600;
  const rounded = Math.round(hours * 10) / 10;
  return rounded === 1 ? "1 hour" : `${rounded} hours`;
}
