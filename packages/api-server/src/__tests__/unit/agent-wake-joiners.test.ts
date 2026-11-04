import { describe, it, expect, afterEach, vi } from "vitest";
import { createAgentWake } from "../../modules/agents/infrastructure/agent-wake.js";
import type { KubeObject } from "../../modules/agents/infrastructure/k8s.js";

function agentObj(ready: boolean): KubeObject {
  return {
    metadata: { name: "a1", annotations: {} },
    spec: { name: "a1" },
    status: {
      conditions: [
        ready
          ? { type: "Ready", status: "True" }
          : { type: "Ready", status: "False", reason: "Hibernated" },
      ],
    },
  } as KubeObject;
}

// A wake whose activity write holds until the test lets it go, so a second
// call can join the first while it runs.
function wakeWithHeldWrite(state: { ready: boolean }) {
  const writes: Array<() => void> = [];
  const wake = createAgentWake({
    readCached: async () => agentObj(state.ready),
    readLive: async () => agentObj(state.ready),
    isReady: async () => state.ready,
    bumpLastActivity: () =>
      new Promise<void>((resolve) => writes.push(resolve)),
    whenChanged: () => ({ changed: new Promise<void>(() => {}), cancel() {} }),
  });
  const releaseWrites = () => {
    for (const w of writes.splice(0)) w();
  };
  return { wake, releaseWrites, writes };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ensureReady joiners", () => {
  it("a call joining one on a running Agent is not told it wakes", async () => {
    const { wake, releaseWrites, writes } = wakeWithHeldWrite({ ready: true });
    const notices: string[] = [];
    const first = wake.ensureReady("a1", {
      onWaking: () => notices.push("first"),
    });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    const joiner = wake.ensureReady("a1", {
      onWaking: () => notices.push("joiner"),
    });
    releaseWrites();
    await Promise.all([first, joiner]);
    expect(notices).toEqual([]);
  });

  it("a call joining one that already found the Agent asleep is told at once", async () => {
    vi.useFakeTimers();
    const state = { ready: false };
    const { wake, releaseWrites, writes } = wakeWithHeldWrite(state);
    const notices: string[] = [];
    const first = wake.ensureReady("a1", {
      onWaking: () => notices.push("first"),
    });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    const joiner = wake.ensureReady("a1", {
      onWaking: () => notices.push("joiner"),
    });
    expect(notices).toEqual(["first", "joiner"]);
    releaseWrites();
    state.ready = true;
    await vi.advanceTimersByTimeAsync(10_000);
    releaseWrites();
    await Promise.all([first, joiner]);
  });

  it("a call that joined before the Agent was found asleep is told once it is", async () => {
    vi.useFakeTimers();
    const state = { ready: false };
    const { wake, releaseWrites } = wakeWithHeldWrite(state);
    const notices: string[] = [];
    const first = wake.ensureReady("a1", {
      onWaking: () => notices.push("first"),
    });
    const joiner = wake.ensureReady("a1", {
      onWaking: () => notices.push("joiner"),
    });
    expect(notices).toEqual([]);
    await vi.waitFor(() => expect(notices).toEqual(["first", "joiner"]));
    releaseWrites();
    state.ready = true;
    await vi.advanceTimersByTimeAsync(10_000);
    releaseWrites();
    await Promise.all([first, joiner]);
  });
});
