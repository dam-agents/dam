import {
  invocationCancelEventPayload,
  type EventReportInput,
  type Plugin,
} from "agent-runtime-api";

import type { EventReporter } from "./trigger-plugin.js";
import { eventPlugin } from "../infrastructure/plugin-registry.js";
import { safeReport } from "../infrastructure/report.js";

const KIND = "invocation-cancel";
const DETAIL_MAX = 2_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: ends one run of this sub-agent that the platform
 * already failed (stopped, timed out, failed to set up) while its work may
 * still run: the turn of the session working on that run is cancelled, or
 * its script is killed, and the other runs in the machine go on. The answer
 * is ok only once that work has ended, so the platform never starts the
 * session's next run beside it; a run whose prompt still waits behind
 * another turn is cancelled when its turn starts. The answer names the
 * session, so the platform knows which conversation the run left behind.
 */
export function createInvocationCancelPlugin(deps: {
  cancelRun: (run: string) => Promise<{ ended: boolean; sessionId?: string }>;
  reporter: EventReporter;
  log: (msg: string) => void;
}): Plugin {
  const report = (input: EventReportInput): Promise<boolean> =>
    safeReport(
      () => deps.reporter.report(input),
      deps.log,
      "[invocation-cancel] event report",
    );

  return eventPlugin(KIND, KIND, async (payload, { eventId }) => {
    const { run } = invocationCancelEventPayload.parse(payload);
    let ended: { ended: boolean; sessionId?: string };
    try {
      ended = await deps.cancelRun(run);
    } catch (err) {
      const detail = `the run could not be ended: ${(err as Error).message}`;
      deps.log(`[invocation-cancel] ${run}: ${detail}`);
      await report({
        eventId,
        outcome: "failed",
        stage: "run",
        detail: detail.slice(0, DETAIL_MAX),
      });
      return;
    }
    const session = ended.sessionId ? { sessionId: ended.sessionId } : {};
    if (!ended.ended) {
      deps.log(`[invocation-cancel] the turn of run ${run} did not end`);
      await report({
        eventId,
        outcome: "failed",
        stage: "run",
        detail: "the run's turn did not end after it was cancelled",
        ...session,
      });
      return;
    }
    deps.log(`[invocation-cancel] ended run ${run}`);
    await report({ eventId, outcome: "ok", stage: "run", ...session });
  });
}
