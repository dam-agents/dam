import type { PendingRestart } from "agent-runtime-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TEST_OVERVIEW: A saved setting reaches the agent's harness only when the
 * harness restarts, and a restart stops the agent's background tasks. The
 * runtime holds such a restart back while a kept task runs. Right after a
 * save, the UI checks the agent for a restart held back this way and asks
 * the user: restart now, which names everything the restart stops, or apply
 * when the tasks finish. A save that needs no restart asks nothing.
 */

const api = vi.hoisted(() => ({
  readPendingRestart: vi.fn<(agentId: string) => Promise<unknown>>(),
  applyPendingRestart: vi.fn<(agentId: string) => Promise<void>>(),
}));
const store = vi.hoisted(() => ({
  dialog: null as { open: boolean } | null,
  showConfirm:
    vi.fn<
      (
        message: string,
        title: string,
        options: { confirmLabel: string; cancelLabel: string },
      ) => Promise<boolean>
    >(),
}));

vi.mock("../../modules/processes/api/pending-restart.js", () => api);
vi.mock("../../store.js", () => ({ useStore: { getState: () => store } }));
vi.mock("../../query-client.js", () => ({
  queryClient: { invalidateQueries: () => Promise.resolve() },
}));
vi.mock("../../lib/toast.js", () => ({ emitToast: () => {} }));

const { askToRestartAfterSave } =
  await import("../../modules/processes/lib/ask-restart-after-save.js");

const waiting: PendingRestart = {
  reason: "env-recycle",
  since: "2026-10-09T08:00:00.000Z",
  blockingTasks: 1,
  stops: { tasks: 2, turns: 1 },
};

beforeEach(() => {
  vi.useFakeTimers();
  store.dialog = null;
  api.readPendingRestart.mockReset();
  api.applyPendingRestart.mockReset().mockResolvedValue();
  store.showConfirm.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ask to restart after a save", () => {
  /**
   * TEST_SCENARIO: The change reaches the runtime a moment after the save,
   * so the first check finds nothing waiting. The next check finds the
   * restart held back by one kept task, while two tasks and one turn run.
   * The user is asked once, the restart button names all three, and
   * choosing it applies the change.
   */
  it("should ask once a held-back restart appears and apply it on Restart now", async () => {
    api.readPendingRestart
      .mockResolvedValueOnce(null)
      .mockResolvedValue(waiting);
    store.showConfirm.mockResolvedValue(true);

    askToRestartAfterSave("agent-1");
    await vi.advanceTimersByTimeAsync(3_000);

    expect(store.showConfirm).toHaveBeenCalledOnce();
    const [message, , options] = store.showConfirm.mock.calls[0]!;
    expect(message).toContain("2 background tasks and 1 running turn");
    expect(options).toEqual({
      confirmLabel: "Restart now (stops 2 tasks, 1 turn)",
      cancelLabel: "Apply when it finishes",
    });
    expect(api.applyPendingRestart).toHaveBeenCalledWith("agent-1");
  });

  /**
   * TEST_SCENARIO: The user picks Apply when it finishes. Nothing restarts,
   * and the check is over, so it does not ask again.
   */
  it("should leave the restart waiting when the user chooses to wait", async () => {
    api.readPendingRestart.mockResolvedValue(waiting);
    store.showConfirm.mockResolvedValue(false);

    askToRestartAfterSave("agent-1");
    await vi.advanceTimersByTimeAsync(15_000);

    expect(store.showConfirm).toHaveBeenCalledOnce();
    expect(api.applyPendingRestart).not.toHaveBeenCalled();
  });

  /**
   * TEST_SCENARIO: The save needed no restart, or nothing held it back.
   * The check stops after its window and never asks.
   */
  it("should stop checking without asking when no restart waits", async () => {
    api.readPendingRestart.mockResolvedValue(null);

    askToRestartAfterSave("agent-1");
    await vi.advanceTimersByTimeAsync(30_000);
    const reads = api.readPendingRestart.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);

    expect(store.showConfirm).not.toHaveBeenCalled();
    expect(reads).toBeGreaterThan(0);
    expect(api.readPendingRestart.mock.calls.length).toBe(reads);
  });

  /**
   * TEST_SCENARIO: The Settings page saves env, connections and harness
   * config one after another. All three saves share one check, so the
   * user is asked once, not three times.
   */
  it("should ask once for several saves in a row", async () => {
    api.readPendingRestart.mockResolvedValue(waiting);
    store.showConfirm.mockResolvedValue(false);

    askToRestartAfterSave("agent-1");
    askToRestartAfterSave("agent-1");
    askToRestartAfterSave("agent-1");
    await vi.advanceTimersByTimeAsync(15_000);

    expect(store.showConfirm).toHaveBeenCalledOnce();
  });
});
