import type {
  EventHandler,
  EventReportInput,
  Plugin,
  SessionMessageEventPayload,
} from "agent-runtime-api";
import { sessionMessageEventPayload } from "agent-runtime-api";

import type { TriggerSessionDriver } from "../../acp/index.js";
import type { EventReporter } from "./trigger-plugin.js";

const KIND = "session-message";
const DETAIL_MAX = 2_000;

export function sessionMessagePrompt(
  from: SessionMessageEventPayload["from"],
  text: string,
): string {
  const who = [
    from.title ? `"${from.title}"` : null,
    from.type ? `a ${from.type} session` : null,
    from.sessionId ? `session ${from.sessionId}` : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
  return `[Message from another session of this agent${who ? ` (${who})` : ""}. Your reply here does not reach it.]\n\n${text}`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Handles the session-message Event: one of the
 * agent's Sessions sent text into another through the send_session_message
 * tool. The message joins the target Session's turn in flight where the
 * harness can take it mid-turn, else waits for the turn to end, as a message
 * typed in the chat does. The outcome goes back so the sender learns whether
 * it arrived.
 */
export function createSessionMessagePlugin(deps: {
  driver: TriggerSessionDriver;
  reporter: EventReporter;
  log: (msg: string) => void;
}): Plugin {
  const report = async (input: EventReportInput): Promise<void> => {
    try {
      await deps.reporter.report(input);
    } catch (err) {
      deps.log(`[session-message] event report failed: ${(err as Error).message}`);
    }
  };

  return {
    name: KIND,
    bindEvent(kind: string): EventHandler {
      if (kind !== KIND) {
        throw new Error(`plugin "${KIND}" does not handle event kind "${kind}"`);
      }
      return async (payload, { eventId }) => {
        const { sessionId, text, from } =
          sessionMessageEventPayload.parse(payload);
        try {
          await deps.driver.start({
            task: sessionMessagePrompt(from, text),
            resumeSessionId: sessionId,
            unattended: true,
            steer: true,
            keepSessionModel: true,
          });
        } catch (err) {
          const detail = `the message could not be delivered: ${(err as Error).message}`;
          deps.log(`[session-message] ${sessionId}: ${detail}`);
          await report({
            eventId,
            outcome: "failed",
            stage: "run",
            detail: detail.slice(0, DETAIL_MAX),
          });
          return;
        }
        await report({ eventId, outcome: "ok", stage: "run" });
      };
    },
  };
}
