import type { EventReportInput } from "agent-runtime-api";
import { safeReport } from "../infrastructure/report.js";

const DETAIL_MAX = 2_000;

export interface ScheduleRunReport {
  turnOutcome(
    sessionId: string,
    end: { stopReason: string | null; error: string | null },
  ): void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A one-time fire settles the moment the machine
 * takes its prompt, so the fire reads success before its turn has run and
 * there is no next occurrence to correct that. The turn is the last thing that
 * can still tell the truth: a fired Session whose turn ends in an error
 * reports its fire as failed over the same event-report route a refused run
 * uses. Only a Session a one-time fire opened carries that event; a person's
 * chat and a recurring fire's Session report nothing, since a failed turn
 * there is theirs and their schedule pays a lost occurrence back itself.
 * The fire's own turn decides it once: its first turn's end forgets the event,
 * clean or not, so a message a person sends into that Session later can never
 * fail the schedule for work that did happen.
 */
export function createScheduleRunReport(deps: {
  fireEventOf: (sessionId: string) => string | undefined;
  forgetFireEvent: (sessionId: string) => void;
  reporter: { report(input: EventReportInput): Promise<void> };
  log: (msg: string) => void;
}): ScheduleRunReport {
  return {
    turnOutcome(sessionId, { error }) {
      const eventId = deps.fireEventOf(sessionId);
      if (eventId === undefined) return;
      deps.forgetFireEvent(sessionId);
      if (error === null) return;
      const detail = error.slice(0, DETAIL_MAX);
      deps.log(`[schedule-run] ${sessionId}: its run failed: ${detail}`);
      void safeReport(
        () =>
          deps.reporter.report({
            eventId,
            outcome: "failed",
            stage: "run",
            detail,
          }),
        deps.log,
        "[schedule-run] run failure report",
      );
    },
  };
}
