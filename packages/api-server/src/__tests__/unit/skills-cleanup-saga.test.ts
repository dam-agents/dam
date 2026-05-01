import { describe, it, expect, vi } from "vitest";
import { startSkillsCleanupSaga } from "../../modules/skills/sagas/skills-cleanup.js";
import { emit, EventType } from "../../events.js";

describe("startSkillsCleanupSaga", () => {
  it("invokes the cleanup callback when InstanceDeleted fires", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const sub = startSkillsCleanupSaga(cleanup);

    emit({ type: EventType.InstanceDeleted, instanceId: "inst-42" });
    // mergeMap-wrapped async work — yield to the microtask queue.
    await new Promise((r) => setImmediate(r));

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledWith("inst-42");
    sub.unsubscribe();
  });

  it("does not bring the saga down when cleanup throws", async () => {
    const cleanup = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    const sub = startSkillsCleanupSaga(cleanup);

    emit({ type: EventType.InstanceDeleted, instanceId: "inst-1" });
    emit({ type: EventType.InstanceDeleted, instanceId: "inst-2" });
    await new Promise((r) => setImmediate(r));

    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenNthCalledWith(1, "inst-1");
    expect(cleanup).toHaveBeenNthCalledWith(2, "inst-2");
    sub.unsubscribe();
  });

  it("ignores other event types", async () => {
    const cleanup = vi.fn();
    const sub = startSkillsCleanupSaga(cleanup);

    emit({ type: EventType.InstanceCreated, instanceId: "x", agentId: "a" });
    emit({ type: EventType.InstanceUpdated, instanceId: "x" });
    await new Promise((r) => setImmediate(r));

    expect(cleanup).not.toHaveBeenCalled();
    sub.unsubscribe();
  });
});
