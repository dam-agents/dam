// TEST_OVERVIEW: the lease-elected K8s agent watch projects resource transitions into per-owner invalidation hints, including deletions that happened while the watch was disconnected.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startAgentWatch } from "../../modules/live-events/infrastructure/k8s-agent-watch.js";
import type { LiveEventsBus } from "../../modules/live-events/services/live-events-service.js";

type OnEvent = (phase: string, resource: unknown) => void;
type OnEnd = (err?: unknown) => void;

function agent(name: string) {
  return {
    metadata: { name, labels: { owner: `sub-${name}` } },
    spec: { image: "x" },
  };
}

describe("k8s agent watch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function harness() {
    const hints: { ownerSub: string; agentId?: string }[] = [];
    const bus = {
      publish: (ownerSub: string, hint: { agentId?: string }) =>
        void hints.push({ ownerSub, agentId: hint.agentId }),
    } as unknown as LiveEventsBus;
    const conns: { onEvent: OnEvent; onEnd: OnEnd }[] = [];
    const watch = startAgentWatch(
      bus,
      {
        watchCustomObjects: (_plural, onEvent, onEnd) => {
          conns.push({ onEvent: onEvent as OnEvent, onEnd: onEnd as OnEnd });
          return () => {};
        },
      },
      { plural: "agents", ownerLabel: "owner", log: () => {}, debounceMs: 1 },
    );
    return { hints, conns, watch };
  }

  // TEST_SCENARIO: a watch replay carries no synthetic DELETED — an agent deleted during a reconnect gap must still get a hint once the replay settles, or open tabs show it forever.
  it("hints an agent missing from the reconnect replay", async () => {
    const { hints, conns, watch } = harness();
    conns[0]!.onEvent("ADDED", agent("a"));
    conns[0]!.onEvent("ADDED", agent("b"));
    await vi.advanceTimersByTimeAsync(20_000);
    hints.length = 0;

    conns[0]!.onEnd(new Error("gone"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(conns).toHaveLength(2);
    conns[1]!.onEvent("ADDED", agent("a"));

    await vi.advanceTimersByTimeAsync(20_000);
    expect(hints).toEqual([{ ownerSub: "sub-b", agentId: "b" }]);
    watch.stop();
  });

  it("does not re-hint unchanged agents on reconnect", async () => {
    const { hints, conns, watch } = harness();
    conns[0]!.onEvent("ADDED", agent("a"));
    await vi.advanceTimersByTimeAsync(20_000);
    hints.length = 0;

    conns[0]!.onEnd(new Error("gone"));
    await vi.advanceTimersByTimeAsync(5_000);
    conns[1]!.onEvent("ADDED", agent("a"));
    await vi.advanceTimersByTimeAsync(20_000);

    expect(hints).toEqual([]);
    watch.stop();
  });
});
