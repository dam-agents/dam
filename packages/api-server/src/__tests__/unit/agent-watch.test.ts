// TEST_OVERVIEW: the agent watch projects store changes into per-owner invalidation hints. The store's emitter cannot drop an event, so what is left to get right is what must NOT reach a browser: a change that only touched a volatile annotation, or a re-announce of identical content.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startAgentWatch } from "../../modules/live-events/infrastructure/agent-watch.js";
import type { LiveEventsBus } from "../../modules/live-events/services/live-events-service.js";
import { fakeAgentStore } from "../helpers/fake-agent-store.js";
import { LAST_ACTIVITY_KEY } from "../../modules/agents/infrastructure/labels.js";

describe("agent watch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function harness() {
    const hints: { owner: string; agentId?: string }[] = [];
    const bus = {
      publish: (owner: string, hint: { agentId?: string }) =>
        void hints.push({ owner, agentId: hint.agentId }),
    } as unknown as LiveEventsBus;
    const { store } = fakeAgentStore();
    const watch = startAgentWatch(bus, store, {
      debounceMs: 1,
      volatileAnnotations: [LAST_ACTIVITY_KEY],
    });
    return { hints, store, watch };
  }

  it("hints the owner when an agent appears and when its status changes", async () => {
    const { hints, store, watch } = harness();
    await store.create({
      id: "a",
      owner: "sub-a",
      annotations: {},
      spec: { image: "x" },
    });
    await store.writeStatus("a", { ready: true });
    await vi.advanceTimersByTimeAsync(20);

    expect(hints).toEqual([{ owner: "sub-a", agentId: "a" }]);
    watch.stop();
  });

  // TEST_SCENARIO: the supervisor stamps activity on every turn. That is not a change a tab needs to re-read for, and hinting it would put every agent's traffic on every open browser.
  it("ignores a change that only touched a volatile annotation", async () => {
    const { hints, store, watch } = harness();
    await store.create({
      id: "a",
      owner: "sub-a",
      annotations: {},
      spec: { image: "x" },
    });
    await vi.advanceTimersByTimeAsync(20);
    hints.length = 0;

    await store.patchAnnotations("a", {
      [LAST_ACTIVITY_KEY]: new Date().toISOString(),
    });
    await vi.advanceTimersByTimeAsync(20);

    expect(hints).toEqual([]);
    watch.stop();
  });

  it("hints a deletion so the row leaves open tabs", async () => {
    const { hints, store, watch } = harness();
    await store.create({
      id: "a",
      owner: "sub-a",
      annotations: {},
      spec: { image: "x" },
    });
    await vi.advanceTimersByTimeAsync(20);
    hints.length = 0;

    await store.delete("a");
    await vi.advanceTimersByTimeAsync(20);

    expect(hints).toEqual([{ owner: "sub-a", agentId: "a" }]);
    watch.stop();
  });

  it("coalesces a burst of changes into one hint", async () => {
    const { hints, store, watch } = harness();
    await store.create({
      id: "a",
      owner: "sub-a",
      annotations: {},
      spec: { image: "x" },
    });
    await store.writeStatus("a", { ready: false });
    await store.writeStatus("a", { ready: true });
    await vi.advanceTimersByTimeAsync(20);

    expect(hints).toEqual([{ owner: "sub-a", agentId: "a" }]);
    watch.stop();
  });

  it("stop() detaches from the store", async () => {
    const { hints, store, watch } = harness();
    watch.stop();
    await store.create({
      id: "a",
      owner: "sub-a",
      annotations: {},
      spec: { image: "x" },
    });
    await vi.advanceTimersByTimeAsync(20);

    expect(hints).toEqual([]);
  });
});
