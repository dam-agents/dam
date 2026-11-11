/**
 * TEST_OVERVIEW: The limit on how often Agents change their own posts. A
 * workspace takes a fixed number of edits a minute, shared by every Agent in
 * it, and each Agent has a smaller limit of its own so one Agent cannot use
 * up the share of the others. An edit over a limit is refused with the time
 * to wait, is not counted, and is admitted again once the window has moved
 * on.
 */
import { describe, expect, it } from "vitest";
import { createPostEditRateLimit } from "../../modules/channels/domain/post-edit-rate-limit.js";

function limit(opts: { perWorkspace?: number; perAgent?: number } = {}) {
  const clock = { at: 0 };
  const edits = createPostEditRateLimit({
    perWorkspace: opts.perWorkspace ?? 4,
    perAgent: opts.perAgent ?? 2,
    windowMs: 1000,
    now: () => clock.at,
  });
  return { clock, edits };
}

describe("createPostEditRateLimit", () => {
  it("admits an agent's edits up to its own limit", () => {
    const { edits } = limit();

    expect(edits.admit("T1", "agent-1")).toEqual({ admitted: true });
    expect(edits.admit("T1", "agent-1")).toEqual({ admitted: true });
    expect(edits.admit("T1", "agent-1")).toMatchObject({ admitted: false });
  });

  /** TEST_SCENARIO: One Agent in a loop must not stop the others from
   *  editing: its own limit is reached long before the workspace's. */
  it("keeps one agent's limit from stopping another agent", () => {
    const { edits } = limit();
    edits.admit("T1", "agent-1");
    edits.admit("T1", "agent-1");

    expect(edits.admit("T1", "agent-1")).toMatchObject({ admitted: false });
    expect(edits.admit("T1", "agent-2")).toEqual({ admitted: true });
  });

  /** TEST_SCENARIO: The messenger counts a workspace's edits together, so the
   *  shared limit holds even when no single Agent is over its own. */
  it("refuses an edit over the workspace's limit, whoever makes it", () => {
    const { edits } = limit({ perWorkspace: 3 });
    edits.admit("T1", "agent-1");
    edits.admit("T1", "agent-2");
    edits.admit("T1", "agent-3");

    expect(edits.admit("T1", "agent-4")).toMatchObject({ admitted: false });
    expect(edits.admit("T2", "agent-4")).toEqual({ admitted: true });
  });

  /** TEST_SCENARIO: A caller asks before it reads the post back, so an edit
   *  that will be refused costs the messenger nothing. Asking counts no
   *  edit. */
  it("answers a check without counting an edit", () => {
    const { edits } = limit();

    expect(edits.check("T1", "agent-1")).toEqual({ admitted: true });
    expect(edits.check("T1", "agent-1")).toEqual({ admitted: true });
    edits.admit("T1", "agent-1");
    edits.admit("T1", "agent-1");
    expect(edits.check("T1", "agent-1")).toMatchObject({ admitted: false });
  });

  /** TEST_SCENARIO: A refused edit says how long until the oldest counted
   *  edit leaves the window, and the same edit is admitted after that wait.
   *  The refusal itself is not counted, so retrying early does not push the
   *  wait further out. */
  it("says how long to wait, and admits the edit after it", () => {
    const { clock, edits } = limit();
    edits.admit("T1", "agent-1");
    clock.at = 400;
    edits.admit("T1", "agent-1");

    clock.at = 600;
    expect(edits.admit("T1", "agent-1")).toEqual({
      admitted: false,
      retryAfterMs: 400,
    });
    clock.at = 900;
    expect(edits.admit("T1", "agent-1")).toEqual({
      admitted: false,
      retryAfterMs: 100,
    });
    clock.at = 1001;
    expect(edits.admit("T1", "agent-1")).toEqual({ admitted: true });
  });
});
