import { describe, it, expect, vi } from "vitest";

import type { PromptEnvelope } from "../../modules/prompts/domain/types.js";
import type {
  PendingEntry,
  PromptsStore,
} from "../../modules/prompts/infrastructure/redis-prompts-store.js";
import { createPromptsForwarder } from "../../modules/prompts/services/prompts-forwarder.js";

function envelope(promptId: string): PromptEnvelope {
  return {
    promptId,
    instanceId: "inst-1",
    sessionId: "sid-1",
    ownerSub: "u",
    prompt: [{ type: "text", text: "hi" }],
  };
}

function entry(id: string, env: PromptEnvelope): PendingEntry {
  return { id, envelope: JSON.stringify(env) };
}

interface FakeStoreOptions {
  /** Series of `read(...)` results, consumed in order. After exhaustion the
   *  store returns []. The loop blocks briefly between reads, so series of
   *  N elements drives N iterations before the loop idles. */
  fresh?: PendingEntry[][];
  reclaimed?: PendingEntry[][];
  /** Forward outcomes per entry id. Defaults to success when not specified. */
  forwardErrors?: Map<string, Error>;
}

function makeFakeStore(opts: FakeStoreOptions = {}): {
  store: PromptsStore;
  acks: string[];
  trims: string[];
  ensureGroupCalls: number;
  freshCalls: number;
  reclaimedCalls: number;
} {
  const acks: string[] = [];
  const trims: string[] = [];
  let ensureGroupCalls = 0;
  let freshCalls = 0;
  let reclaimedCalls = 0;
  const fresh = opts.fresh ?? [];
  const reclaimed = opts.reclaimed ?? [];
  return {
    acks,
    trims,
    get ensureGroupCalls() { return ensureGroupCalls; },
    get freshCalls() { return freshCalls; },
    get reclaimedCalls() { return reclaimedCalls; },
    store: {
      async dedupOrAppend() { throw new Error("not used"); },
      async ensureGroup() { ensureGroupCalls++; },
      async read() {
        const i = freshCalls++;
        const entries = fresh[i];
        if (entries && entries.length > 0) return entries;
        // Real XREADGROUP BLOCK yields to the kernel/event loop while
        // waiting; the fake must too, otherwise the await-chain stays on
        // the microtask queue and starves setTimeout-based test polling
        // and the forwarder's `stop()` from ever observing `running=false`.
        await new Promise((r) => setTimeout(r, 1));
        return [];
      },
      async autoClaim() {
        const i = reclaimedCalls++;
        const entries = reclaimed[i];
        if (entries && entries.length > 0) return entries;
        // Same yield-to-macrotasks reasoning as `read` — XAUTOCLAIM is
        // a real Redis call in production, here we simulate the yield.
        await new Promise((r) => setTimeout(r, 1));
        return [];
      },
      async ack(id) { acks.push(id); },
      async trim(id) { trims.push(id); },
      async close() {},
    },
  };
}

async function tickUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!predicate()) throw new Error("timeout waiting for forwarder progress");
}

describe("createPromptsForwarder", () => {
  it("acks and trims fresh entries that forward successfully", async () => {
    const fake = makeFakeStore({
      fresh: [[entry("1-0", envelope("p-a")), entry("1-1", envelope("p-b"))]],
    });
    const forward = vi.fn().mockResolvedValue(undefined);

    const f = createPromptsForwarder({
      store: fake.store,
      forward,
      consumerName: "test-1",
      blockMs: 5,
      reclaimIdleMs: 30_000,
      errorBackoffMs: 1,
    });
    f.start();
    await tickUntil(() => fake.acks.length >= 2);
    await f.stop();

    expect(forward).toHaveBeenCalledTimes(2);
    expect(fake.acks).toEqual(["1-0", "1-1"]);
    expect(fake.trims).toEqual(["1-0", "1-1"]);
  });

  it("leaves entries unacked when forward throws — XAUTOCLAIM picks them up later", async () => {
    const errorById = new Map([["1-0", new Error("wrapper unreachable")]]);
    const fake = makeFakeStore({
      fresh: [[entry("1-0", envelope("p-a")), entry("1-1", envelope("p-b"))]],
    });
    const forward = vi.fn().mockImplementation(async (env: PromptEnvelope) => {
      // Match by promptId order — first entry fails, second succeeds.
      if (env.promptId === "p-a") throw errorById.get("1-0");
    });

    const f = createPromptsForwarder({
      store: fake.store,
      forward,
      consumerName: "test-1",
      blockMs: 5,
      reclaimIdleMs: 30_000,
      errorBackoffMs: 1,
    });
    f.start();
    await tickUntil(() => fake.acks.length >= 1);
    await f.stop();

    expect(forward).toHaveBeenCalledTimes(2);
    // Failed entry stays pending; only the successful one is acked.
    expect(fake.acks).toEqual(["1-1"]);
    expect(fake.trims).toEqual(["1-1"]);
  });

  it("processes reclaimed entries before fresh ones each iteration", async () => {
    // Simulates a forwarder picking up its own past failure (or another
    // replica's) before draining the fresh queue.
    const fake = makeFakeStore({
      reclaimed: [[entry("R-0", envelope("p-stale"))]],
      fresh: [[entry("F-0", envelope("p-new"))]],
    });
    const forwardOrder: string[] = [];
    const forward = vi.fn().mockImplementation(async (env: PromptEnvelope) => {
      forwardOrder.push(env.promptId);
    });

    const f = createPromptsForwarder({
      store: fake.store,
      forward,
      consumerName: "test-1",
      blockMs: 5,
      reclaimIdleMs: 1,
      errorBackoffMs: 1,
    });
    f.start();
    await tickUntil(() => fake.acks.length >= 2);
    await f.stop();

    expect(forwardOrder).toEqual(["p-stale", "p-new"]);
  });

  it("acks-and-drops malformed envelopes instead of leaving them stuck", async () => {
    // A bad JSON entry would otherwise sit pending forever — XAUTOCLAIM
    // would keep handing it back, no consumer would ever ack, and the
    // group's pending list would grow without bound.
    const malformed: PendingEntry = { id: "1-0", envelope: "{not json" };
    const fake = makeFakeStore({ fresh: [[malformed]] });
    const forward = vi.fn();

    const f = createPromptsForwarder({
      store: fake.store,
      forward,
      consumerName: "test-1",
      blockMs: 5,
      errorBackoffMs: 1,
    });
    f.start();
    await tickUntil(() => fake.acks.length >= 1);
    await f.stop();

    expect(forward).not.toHaveBeenCalled();
    expect(fake.acks).toEqual(["1-0"]);
    expect(fake.trims).toEqual(["1-0"]);
  });

  it("ensures the consumer group exactly once per start", async () => {
    const fake = makeFakeStore({});
    const f = createPromptsForwarder({
      store: fake.store,
      forward: async () => {},
      consumerName: "test-1",
      blockMs: 5,
      errorBackoffMs: 1,
    });
    f.start();
    await tickUntil(() => fake.freshCalls >= 1);
    await f.stop();

    expect(fake.ensureGroupCalls).toBe(1);
  });
});
