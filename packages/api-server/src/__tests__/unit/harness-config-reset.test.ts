import { describe, it, expect } from "vitest";
import type { HarnessConfigSnapshotPatch } from "api-server-api";
import { EventType, events$, type HarnessConfigChanged } from "../../events.js";
import { createHarnessConfigReset } from "../../modules/harness-config/services/harness-config-reset.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { IBM_LITELLM_HOST } from "api-server-api";
import { ETE_BYPASS_RESET } from "../../modules/harness-config/compose.js";

// TEST_OVERVIEW: a one-off reset of Claude Code's default permission mode, which an earlier image rewrite left at bypassPermissions on the Agents holding one Connection preset. The cohort is frozen once, before any Agent is processed, and an Agent of it is settled in one transaction holding its snapshot lock — mode read, queued change and declaration together — so no owner change can land between the decision and what the Agent is told. A failed Agent stays pending and is retried; an Agent that becomes eligible afterwards is never added.

const HARNESS = "claude-code";
const BYPASS = "bypassPermissions";

type Snapshot = { mode: string | null } | null;

function harness(opts: {
  pending?: string[][];
  froze?: boolean;
  snapshots?: Record<string, { named: Snapshot; root: Snapshot }>;
  failLock?: string[];
  claimedBy?: string[];
  enqueue?: (agentId: string) => Promise<void>;
  owner?: string | null;
  hintTimeoutMs?: number;
}) {
  const queues = opts.pending ?? [[]];
  const order: string[] = [];
  const calls = {
    queries: [] as { after: string; limit: number }[],
    rosters: 0,
    retired: [] as { agentId: string; inLock: boolean }[],
    claims: [] as { agentId: string; inLock: boolean; accepted: boolean }[],
    queued: [] as {
      agentId: string;
      change: unknown;
      inLock: boolean;
    }[],
    enqueued: [] as string[],
    merges: [] as {
      agentId: string;
      patch: HarnessConfigSnapshotPatch;
      confirmed: boolean;
      harness?: string;
      inLock: boolean;
    }[],
    logs: [] as string[],
  };
  let holdingLock = false;
  const job = createHarnessConfigReset({
    repo: {
      roster: async () => {
        calls.rosters += 1;
        order.push("roster");
        return opts.froze ?? true;
      },
      frozen: async () => !(opts.froze ?? true),
      retire: async (agentId, tx, harness) => {
        calls.retired.push({
          agentId,
          inLock: holdingLock && tx !== undefined,
        });
        return harness === undefined || harness === HARNESS;
      },
      pending: async (input) => {
        calls.queries.push(input);
        return queues.shift() ?? [];
      },
      claim: async (agentId, tx) => {
        const accepted = !opts.claimedBy?.includes(agentId);
        calls.claims.push({
          agentId,
          inLock: holdingLock && tx !== undefined,
          accepted,
        });
        order.push(`claim:${tx !== undefined}`);
        return accepted;
      },
    },
    snapshotRepo: {
      read: async (agentId, named) => {
        const snapshot = opts.snapshots?.[agentId];
        const mode = named === undefined ? snapshot?.root : snapshot?.named;
        order.push(`read:${named ?? "root"}`);
        return mode ? ({ mode: mode.mode } as never) : null;
      },
      merge: async (agentId, patch, mergeOpts) => {
        calls.merges.push({
          agentId,
          patch,
          confirmed: mergeOpts.confirmed,
          ...(mergeOpts.harness && { harness: mergeOpts.harness }),
          inLock: holdingLock && mergeOpts.tx !== undefined,
        });
        order.push(`merge:${mergeOpts.tx !== undefined}`);
      },
      locked: async (agentId, work) => {
        if (opts.failLock?.includes(agentId))
          throw new Error(`lock timed out for ${agentId}`);
        order.push("locked:start");
        holdingLock = true;
        try {
          return await work({} as never);
        } finally {
          holdingLock = false;
          order.push("locked:end");
        }
      },
    },
    eventQueue: {
      queue: async (agentId, change, tx) => {
        calls.queued.push({
          agentId,
          change,
          inLock: holdingLock && tx !== undefined,
        });
        order.push(`queue:${tx !== undefined}`);
        return 1;
      },
    },
    enqueue: async (agentId) => {
      calls.enqueued.push(agentId);
      await opts.enqueue?.(agentId);
    },
    ownerOf: async () => (opts.owner === undefined ? "owner-1" : opts.owner),
    harness: HARNESS,
    from: BYPASS,
    to: "auto",
    log: (message) => {
      calls.logs.push(message);
    },
    batch: 2,
    ...(opts.hintTimeoutMs !== undefined && {
      hintTimeoutMs: opts.hintTimeoutMs,
    }),
  });
  return { job, calls, order };
}

const bypassing = { named: { mode: BYPASS }, root: { mode: BYPASS } };

async function hints(run: () => Promise<unknown>) {
  const seen: HarnessConfigChanged[] = [];
  const sub = events$().subscribe((event) => {
    if (event.type === EventType.HarnessConfigChanged) seen.push(event);
  });
  try {
    await run();
  } finally {
    sub.unsubscribe();
  }
  return seen;
}

describe("harness-config reset", () => {
  // TEST_SCENARIO: an Agent that holds the Connection and reports bypassPermissions is queued the change the Config panel sends, so a running pod rewrites its settings file and a stopped one does it at its next start. The claim, the read, the queued change and the declaration are one transaction holding the Agent's snapshot lock, so no owner change can land between the decision and what the Agent is told.
  it("resets a bypassing Agent in one locked transaction", async () => {
    const { job, calls, order } = harness({
      pending: [["a1"]],
      snapshots: { a1: bypassing },
    });

    const seen = await hints(() => job.run());

    expect(order).toEqual([
      "roster",
      "locked:start",
      "claim:true",
      "read:claude-code",
      "queue:true",
      "merge:true",
      "locked:end",
    ]);
    expect(calls.queued).toEqual([
      {
        agentId: "a1",
        change: { harness: HARNESS, mode: "auto" },
        inLock: true,
      },
    ]);
    expect(calls.merges).toEqual([
      {
        agentId: "a1",
        patch: { mode: "auto" },
        confirmed: false,
        harness: HARNESS,
        inLock: true,
      },
    ]);
    expect(calls.enqueued).toEqual(["a1"]);
    expect(seen).toEqual([
      {
        type: EventType.HarnessConfigChanged,
        agentId: "a1",
        ownerSub: "owner-1",
      },
    ]);
    expect(calls.claims).toEqual([
      { agentId: "a1", inLock: true, accepted: true },
    ]);
  });

  // TEST_SCENARIO: the snapshot keeps the default harness's mode at its root and each carried harness's mode beside it, so a stale bypass at the root must not override a newer non-bypass mode the harness itself reported.
  it("decides from the harness's own mode and leaves a newer one alone", async () => {
    const { job, calls } = harness({
      pending: [["a1"]],
      snapshots: { a1: { named: { mode: "plan" }, root: { mode: BYPASS } } },
    });

    const { reset } = await job.run();

    expect(reset).toBe(0);
    expect(calls.queued).toEqual([]);
    expect(calls.merges).toEqual([]);
    expect(calls.claims).toEqual([
      { agentId: "a1", inLock: true, accepted: true },
    ]);
  });

  // TEST_SCENARIO: a runtime that reports one harness keeps the mode at the snapshot root only, so the change goes there, unscoped, exactly as the Config panel sends it for that Agent.
  it("falls back to the root snapshot when no harness's own mode is there", async () => {
    const { job, calls } = harness({
      pending: [["a1"]],
      snapshots: { a1: { named: null, root: { mode: BYPASS } } },
    });

    const { reset } = await job.run();

    expect(reset).toBe(1);
    expect(calls.queued).toEqual([
      { agentId: "a1", change: { mode: "auto" }, inLock: true },
    ]);
    expect(calls.merges).toEqual([
      {
        agentId: "a1",
        patch: { mode: "auto" },
        confirmed: false,
        inLock: true,
      },
    ]);
  });

  // TEST_SCENARIO: another mode is the owner's choice, so only bypassPermissions is reset.
  it("leaves another reported mode alone", async () => {
    const { job, calls } = harness({
      pending: [["a1"]],
      snapshots: { a1: { named: { mode: "acceptEdits" }, root: null } },
    });

    const { reset } = await job.run();

    expect(reset).toBe(0);
    expect(calls.queued).toEqual([]);
  });

  // TEST_SCENARIO: the frozen cohort is what makes the reset once: a later start finds the pass's own row and settles no Agent the cohort does not hold, so an Agent created, granted the Connection or set to Bypass afterwards is never reset.
  it("does nothing at all once the cohort is settled", async () => {
    const { job, calls } = harness({ froze: false });

    const { reset } = await job.run();

    expect(reset).toBe(0);
    expect(calls.rosters).toBe(1);
    expect(calls.queued).toEqual([]);
    expect(calls.logs.join("\n")).toContain("cohort was frozen already");
  });

  // TEST_SCENARIO: the pending list is read before an Agent's transaction, so another boot can settle that Agent, or its owner can choose a new mode, in between; the conditional claim inside the lock is what decides, so the same Agent is never corrected twice.
  it("skips an Agent another boot settled after the pending read", async () => {
    const { job, calls } = harness({
      pending: [["a1"]],
      claimedBy: ["a1"],
      snapshots: { a1: { named: { mode: BYPASS }, root: null } },
    });

    const { reset } = await job.run();

    expect(reset).toBe(0);
    expect(calls.claims).toEqual([
      { agentId: "a1", inLock: true, accepted: false },
    ]);
    expect(calls.queued).toEqual([]);
    expect(calls.merges).toEqual([]);
  });

  // TEST_SCENARIO: the cohort is frozen before any Agent is processed, so an Agent whose correction fails is retried on a later start without reopening membership to Agents that became eligible in between.
  it("retries a pending Agent without extending the cohort", async () => {
    const first = harness({
      pending: [["a1", "a2"]],
      snapshots: { a1: bypassing, a2: bypassing },
      failLock: ["a1"],
    });
    const failedRun = await first.job.run();
    const second = harness({
      froze: false,
      pending: [["a1"]],
      snapshots: { a1: bypassing },
    });
    const retried = await second.job.run();

    expect(failedRun).toEqual({ reset: 1, failed: 1 });
    expect(
      first.calls.claims.filter((c) => c.accepted).map((c) => c.agentId),
    ).toEqual(["a2"]);
    expect(retried).toEqual({ reset: 1, failed: 0 });
    expect(second.calls.queued.map((q) => q.agentId)).toEqual(["a1"]);
  });

  // TEST_SCENARIO: an Agent's row can be held by another transaction, so its wait is bounded: the pass goes on to the independent Agents and the blocked one is retried on a later start rather than recorded as finished.
  it("bounds one Agent's wait and carries on with the rest", async () => {
    const { job, calls } = harness({
      pending: [["a1", "a2"]],
      snapshots: { a1: bypassing, a2: bypassing },
      failLock: ["a1"],
    });

    const { reset, failed } = await job.run();

    expect(reset).toBe(1);
    expect(failed).toBe(1);
    expect(calls.queued.map((q) => q.agentId)).toEqual(["a2"]);
    expect(
      calls.claims.filter((c) => c.accepted).map((c) => c.agentId),
    ).toEqual(["a2"]);
    expect(calls.logs.join("\n")).toContain("lock timed out for a1");
  });

  // TEST_SCENARIO: the correction is durable once its transaction commits, so a failure to wake the pod afterwards must not undo the reset or make the Agent eligible again.
  it("keeps a committed reset when waking the pod fails", async () => {
    const { job, calls } = harness({
      pending: [["a1"]],
      snapshots: { a1: bypassing },
      enqueue: async () => {
        throw new Error("redis is down");
      },
    });

    const { reset, failed } = await job.run();

    expect(reset).toBe(1);
    expect(failed).toBe(0);
    expect(calls.claims).toEqual([
      { agentId: "a1", inLock: true, accepted: true },
    ]);
    expect(calls.logs.join("\n")).toContain("redis is down");
  });

  // TEST_SCENARIO: a Redis that never answers must not hold the pass, because the queued change is durable and hello or the sweep fetches it.
  it("does not wait for a Redis that never answers", async () => {
    const { job, calls } = harness({
      pending: [["a1"], ["a2"]],
      snapshots: { a1: bypassing, a2: bypassing },
      enqueue: () => new Promise<void>(() => {}),
      hintTimeoutMs: 50,
    });

    const { reset } = await job.run();

    expect(reset).toBe(2);
    expect(calls.claims.filter((c) => c.accepted)).toHaveLength(2);
  });

  // TEST_SCENARIO: an installation can hold more Agents than one query should read, so the run pages through them and stops on an empty page.
  it("pages through the Agents a batch at a time", async () => {
    const { job, calls } = harness({
      pending: [["a1", "a2"], ["a3"], []],
      snapshots: { a1: bypassing, a2: bypassing, a3: bypassing },
    });

    const { reset } = await job.run();

    expect(reset).toBe(3);
    expect(calls.queries).toEqual([
      { after: "", limit: 2 },
      { after: "a2", limit: 2 },
      { after: "a3", limit: 2 },
    ]);
  });

  // TEST_SCENARIO: the reset is coded against one Connection preset, so it must fail loudly if that preset is renamed and the reset would match nothing.
  it("names the ETE LiteLLM Connection preset", () => {
    const preset = buildCatalog().find(
      (t) => t.id === ETE_BYPASS_RESET.template,
    );
    expect(preset).toMatchObject({
      name: "IBM ETE LiteLLM Proxy",
      host: IBM_LITELLM_HOST,
    });
    expect(ETE_BYPASS_RESET).toMatchObject({
      harness: HARNESS,
      from: BYPASS,
      to: "auto",
    });
  });
});
