import { describe, expect, it } from "vitest";
import type { EventReportInput } from "agent-runtime-api";
import { createScheduleRunReport } from "../../modules/runtime-channel/services/schedule-run-report.js";

/**
 * TEST_OVERVIEW: A one-time schedule has no next occurrence to pay a lost run
 * back, so the one place that can still tell its owner the truth is the turn
 * the fire opened. A turn that ended in an error reports the fire as failed;
 * a turn that ended cleanly, or a Session no fire opened, reports nothing.
 */

function world(fireEvents: Record<string, string | undefined> = {}) {
  const reports: EventReportInput[] = [];
  const log: string[] = [];
  return {
    reports,
    log,
    reporter: createScheduleRunReport({
      fireEventOf: (sessionId) => fireEvents[sessionId],
      reporter: { report: async (input) => void reports.push(input) },
      log: (msg: string) => void log.push(msg),
    }),
  };
}

describe("schedule run report", () => {
  /**
   * TEST_SCENARIO: a fired one-time session's harness goes away mid-turn, so
   * the turn ends with an error. The fire's event is reported failed, with the
   * cause, over the same route a refused run uses.
   */
  it("reports the fire as failed when its session's turn ends in an error", async () => {
    const { reports, reporter } = world({ "sess-1": "sch-1:1700000000000" });

    reporter.turnOutcome("sess-1", {
      stopReason: null,
      error: "the harness exited (signal SIGKILL) mid-turn",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reports).toEqual([
      {
        eventId: "sch-1:1700000000000",
        outcome: "failed",
        stage: "run",
        detail: "the harness exited (signal SIGKILL) mid-turn",
      },
    ]);
  });

  /**
   * TEST_SCENARIO: a fired one-time session's turn ends with nothing wrong —
   * the task did its work. Nothing is reported, so the fire keeps the success
   * its delivery recorded.
   */
  it("reports nothing when the turn ends cleanly", async () => {
    const { reports, reporter } = world({ "sess-1": "sch-1:1700000000000" });

    reporter.turnOutcome("sess-1", { stopReason: "end_turn", error: null });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reports).toEqual([]);
  });

  /**
   * TEST_SCENARIO: a person's chat session and a recurring schedule's session
   * carry no fire event, so a turn that fails in them stays their own business
   * and never moves a schedule's result.
   */
  it("reports nothing for a session no one-time fire opened", async () => {
    const { reports, reporter } = world();

    reporter.turnOutcome("chat-1", { stopReason: null, error: "boom" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reports).toEqual([]);
  });
});
