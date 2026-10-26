import { describe, expect, it } from "vitest";
import type { EventReportInput } from "agent-runtime-api";
import { createScheduleRunReport } from "../../modules/runtime-channel/services/schedule-run-report.js";

/**
 * TEST_OVERVIEW: A one-time schedule has no next occurrence to pay a lost run
 * back, so the one place that can still tell its owner the truth is the first
 * turn of the fire's own Session. That turn decides the fire once — a turn a
 * person sends into the same Session days later is not the fire's.
 */

function world(fireEvents: Record<string, string | undefined> = {}) {
  const events = { ...fireEvents };
  const reports: EventReportInput[] = [];
  const forgotten: string[] = [];
  const log: string[] = [];
  return {
    reports,
    forgotten,
    log,
    reporter: createScheduleRunReport({
      fireEventOf: (sessionId) => events[sessionId],
      forgetFireEvent: (sessionId) => {
        forgotten.push(sessionId);
        delete events[sessionId];
      },
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
    const { reports, forgotten, reporter } = world({
      "sess-1": "sch-1:1700000000000",
    });

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
    expect(forgotten).toEqual(["sess-1"]);
  });

  /**
   * TEST_SCENARIO: the fire's turn ends with nothing wrong, so the session
   * keeps serving — and a person later sends a message into it whose model
   * call fails. The fire was decided by its own turn, so its schedule must not
   * turn failed days after the task did its work.
   */
  it("reports nothing when the turn ends cleanly, and forgets the fire", async () => {
    const { reports, forgotten, reporter } = world({
      "sess-1": "sch-1:1700000000000",
    });

    reporter.turnOutcome("sess-1", { stopReason: "end_turn", error: null });
    reporter.turnOutcome("sess-1", {
      stopReason: null,
      error: "the model call failed",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reports).toEqual([]);
    expect(forgotten).toEqual(["sess-1"]);
  });

  /**
   * TEST_SCENARIO: a person's chat session and a recurring schedule's session
   * carry no fire event, so a turn that fails in them stays their own business
   * and never moves a schedule's result.
   */
  it("reports nothing for a session no one-time fire opened", async () => {
    const { reports, forgotten, reporter } = world();

    reporter.turnOutcome("chat-1", { stopReason: null, error: "boom" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reports).toEqual([]);
    expect(forgotten).toEqual([]);
  });
});
