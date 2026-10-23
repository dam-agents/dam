import type {
  EventReportInput,
  Plugin,
  SessionMessageEventPayload,
} from "agent-runtime-api";
import { sessionMessageEventPayload } from "agent-runtime-api";

import type { TriggerSessionDriver } from "../../acp/index.js";
import type { EventReporter } from "./trigger-plugin.js";
import { eventPlugin } from "../infrastructure/plugin-registry.js";
import { safeReport } from "../infrastructure/report.js";

const KIND = "session-message";
const DETAIL_MAX = 2_000;

export function sessionMessagePrompt(
  from: SessionMessageEventPayload["from"],
  text: string,
  notice?: boolean,
): string {
  if (notice) return `[Notice from the platform]\n\n${text}`;
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
 * typed in the chat does. The outcome goes back over the event report; the
 * platform tells the sending Session when it is a failure.
 */
export function createSessionMessagePlugin(deps: {
  driver: TriggerSessionDriver;
  reporter: EventReporter;
  log: (msg: string) => void;
}): Plugin {
  const report = (input: EventReportInput): Promise<boolean> =>
    safeReport(
      () => deps.reporter.report(input),
      deps.log,
      "[session-message] event report",
    );

  return eventPlugin(KIND, KIND, async (payload, { eventId }) => {
    const { sessionId, text, from, notice } =
      sessionMessageEventPayload.parse(payload);
    try {
      await deps.driver.start({
        task: sessionMessagePrompt(from, text, notice),
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
  });
}
