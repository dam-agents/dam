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
  fresh?: PendingEntry[][];
  reclaim?: PendingEntry[][];
  /** Throw on the Nth ack call (1-indexed). Lets tests simulate a Redis
   *  blip after a successful forward. */
  ackThrowsOn?: number;
}

function makeFakeStore(opts: FakeStoreOptions = {}): {
  store: PromptsStore;
  acks: string[];
  trims: string[];
} {
  const acks: string[] = [];
  const trims: string[] = [];
  let freshCalls = 0;
  let reclaimCalls = 0;
  let ackAttempts = 0;
  const fresh = opts.fresh ?? [];
  const reclaim = opts.reclaim ?? [];
  return {
    acks,
    trims,
    store: {
      async dedupOrAppend() { throw new Error("not used"); },
      async ensureGroup() {},
      async read() {
        const entries = fresh[freshCalls++];
        if (entries && entries.length > 0) return entries;
        // Real XREADGROUP BLOCK yields to the kernel/event loop while
        // waiting; the fake must too, otherwise the await-chain stays on
        // the microtask queue and starves setTimeout-based test polling.
        await new Promise((r) => setTimeout(r, 1));
        return [];
      },
      async autoClaim() {
        const entries = reclaim[reclaimCalls++];
        if (entries && entries.length > 0) return entries;
        await new Promise((r) => setTimeout(r, 1));
        return [];
      },
      async ack(id) {
        ackAttempts++;
        if (opts.ackThrowsOn === ackAttempts) throw new Error("redis blip");
        acks.push(id);
      },
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
  it("acks successful entries and leaves failed ones for XAUTOCLAIM to retry", async () => {
    // The durability invariant: a failing forward must not ack — otherwise
    // the message is lost on a transient wrapper outage. Bundles two
    // entries (one fails, one succeeds) so the test also covers the
    // happy-path ack + trim ordering on the successful entry.
    const fake = makeFakeStore({
      fresh: [[entry("1-0", envelope("p-fail")), entry("1-1", envelope("p-ok"))]],
    });
    const forward = vi.fn().mockImplementation(async (env: PromptEnvelope) => {
      if (env.promptId === "p-fail") throw new Error("wrapper unreachable");
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
    expect(fake.acks).toEqual(["1-1"]);
    expect(fake.trims).toEqual(["1-1"]);
  });

  it("redelivers when ack throws after a successful forward", async () => {
    // The flip side of the durability invariant: forward succeeded but
    // Redis hiccuped on XACK. The entry stays unacked, so the next loop
    // iteration's XAUTOCLAIM reclaims it and forward is called again.
    // The wrapper-side promptId LRU is what prevents the duplicate forward
    // from running at the agent — that's a separate test in acp-runtime.
    const env = envelope("p-retry");
    const fake = makeFakeStore({
      fresh: [[entry("1-0", env)]],
      reclaim: [[], [entry("1-0", env)]],
      ackThrowsOn: 1,
    });
    const forward = vi.fn().mockResolvedValue(undefined);

    const f = createPromptsForwarder({
      store: fake.store,
      forward,
      consumerName: "test-1",
      blockMs: 5,
      reclaimIdleMs: 0,
      errorBackoffMs: 1,
    });
    f.start();
    await tickUntil(() => forward.mock.calls.length >= 2);
    await f.stop();

    expect(forward).toHaveBeenCalledTimes(2);
    // Second ack succeeded; eventually one entry recorded.
    expect(fake.acks).toEqual(["1-0"]);
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
});
