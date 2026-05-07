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

function makeFakeStore(opts: { fresh?: PendingEntry[][] } = {}): {
  store: PromptsStore;
  acks: string[];
  trims: string[];
} {
  const acks: string[] = [];
  const trims: string[] = [];
  let freshCalls = 0;
  const fresh = opts.fresh ?? [];
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
