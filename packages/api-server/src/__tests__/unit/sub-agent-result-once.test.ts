import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSubAgentTools } from "../../apps/harness-api-server/sub-agent-tools.js";
import type { DriverOps } from "../../apps/harness-api-server/driver-ops.js";
import { createSubAgentOutcomeDelivery } from "../../modules/invocations/services/outcome-delivery.js";
import type { InvocationRow } from "../../modules/invocations/infrastructure/invocations-repository.js";
import type { SubAgentOutcomesRepository } from "../../modules/invocations/infrastructure/sub-agent-outcomes-repository.js";
import { invocationRow } from "../helpers/invocations-repo.js";

/**
 * TEST_OVERVIEW: A sub-agent's result reaches the Driver that started it once:
 * as the answer to an await_subagents call, or as one sub-agent-outcome turn
 * when nothing waits, never both. The mesh cuts an open wait whenever any Agent
 * is created or removed, a stopped sub-agent below included. The cut wait keeps
 * its ids for the grace the agent has to call again, and once a turn carried a
 * result, the next wait names it as delivered instead of returning it. The wait
 * and the sweep share one in-memory store that follows the repository's
 * conditional writes: a wait collects a run only where no sweep holds it.
 */

type Handler = (
  args: { ids: string[] },
  extra: { signal: AbortSignal },
) => Promise<unknown>;

type Run = {
  row: InvocationRow;
  awaitedUntil: number | null;
  claimedUntil: number | null;
  deliveredAt: number | null;
  deliveredInTurn: boolean;
  wokeAt: number | null;
};

type Summary = {
  done: { id: string; result?: unknown }[];
  failed: { id: string; reason?: string | null }[];
  delivered: { id: string }[];
  running: string[];
};

const AFTER_GRACE_MS = 120_000;
const WITHIN_GRACE_MS = 30_000;

function world() {
  let skew = 0;
  const clock = () => Date.now() + skew;
  const runs = new Map<string, Run>();
  const at = (d: Date) => d.getTime();
  const live = (until: number | null) => until !== null && until >= clock();

  const repo: SubAgentOutcomesRepository = {
    async markAwaited(driver, ids, until) {
      for (const id of ids) {
        const run = runs.get(id);
        if (run?.row.driverAgentId === driver) run.awaitedUntil = at(until);
      }
    },
    async collect(driver, ids) {
      const asked = ids.flatMap((id) => {
        const run = runs.get(id);
        return run?.row.driverAgentId === driver ? [run] : [];
      });
      for (const run of asked)
        if (run.deliveredAt === null && !live(run.claimedUntil)) {
          run.deliveredAt = clock();
          run.wokeAt = clock();
          run.claimedUntil = null;
        }
      return {
        inTurn: asked
          .filter(
            (r) =>
              r.deliveredInTurn ||
              (r.deliveredAt === null && r.claimedUntil !== null),
          )
          .map((r) => r.row.runId!),
      };
    },
    async claimUndelivered(_limit, until) {
      const claimed = [...runs.values()].filter(
        (r) =>
          r.row.status !== "running" &&
          r.deliveredAt === null &&
          !live(r.awaitedUntil) &&
          !live(r.claimedUntil),
      );
      for (const r of claimed) r.claimedUntil = at(until);
      return claimed.map((r) => r.row);
    },
    async release(ids, lease) {
      for (const id of ids) {
        const run = runs.get(id)!;
        if (run.claimedUntil === at(lease) && run.deliveredAt === null)
          run.claimedUntil = null;
      }
    },
    async markDelivered(ids, lease, inTurn) {
      for (const id of ids) {
        const run = runs.get(id)!;
        if (run.claimedUntil === at(lease) && run.deliveredAt === null) {
          run.deliveredAt = clock();
          run.deliveredInTurn = inTurn;
          run.claimedUntil = null;
        }
      }
    },
    async markWoken(ids) {
      for (const id of ids) runs.get(id)!.wokeAt = clock();
    },
    async listDeliveredUnwoken() {
      return [];
    },
  };

  const turns: { agentId: string; ids: string[]; task: string }[] = [];
  let duringTurn: (() => Promise<void>) | null = null;
  const sweep = createSubAgentOutcomeDelivery({
    repo,
    bump: async (agentId, events) => {
      for (const e of events) {
        const payload = e.payload as { ids: string[]; task: string };
        turns.push({ agentId, ids: payload.ids, task: payload.task });
      }
      await duringTurn?.();
      return events.length;
    },
    enqueue: async () => {},
    wakeUnlessStopped: async () => true,
    pairFields: async () => ({}),
    log: () => {},
    now: () => new Date(clock()),
  });

  function spawn(id: string, driverAgentId: string) {
    runs.set(id, {
      row: invocationRow({
        id,
        runId: id,
        driverAgentId,
        rootDriverId: "agent-root",
        status: "running",
      }),
      awaitedUntil: null,
      claimedUntil: null,
      deliveredAt: null,
      deliveredInTurn: false,
      wokeAt: null,
    });
  }

  function finish(id: string, patch: Partial<InvocationRow>) {
    const run = runs.get(id)!;
    run.row = { ...run.row, completedAt: new Date(clock()), ...patch };
  }

  function waiter(driver: string) {
    const tools = new Map<string, Handler>();
    const server = {
      tool: (name: string, _d: unknown, _s: unknown, handler: Handler) => {
        tools.set(name, handler);
      },
      registerTool: (name: string, _c: unknown, handler: Handler) => {
        tools.set(name, handler);
      },
    } as unknown as McpServer;
    const ops = {
      get: async (id: string) => {
        const run = runs.get(id);
        if (!run || run.row.driverAgentId !== driver) return null;
        return {
          status: run.row.status,
          result: run.row.result,
          errorReason: run.row.errorReason ?? undefined,
          run: run.row.runId,
        };
      },
    } as unknown as DriverOps;
    registerSubAgentTools(server, {
      ops,
      awaits: {
        markAwaited: (ids, until) => repo.markAwaited(driver, ids, until),
        collect: (ids) => repo.collect(driver, ids),
      },
      spawningSession: async () => null,
      waitMs: 10_000,
      pollMs: 5,
    });
    const handler = tools.get("await_subagents")!;
    return (ids: string[], signal = new AbortController().signal) =>
      handler({ ids }, { signal }).then(
        (r) =>
          JSON.parse(
            (r as { content: { text: string }[] }).content[0]!.text,
          ) as Summary,
      );
  }

  return {
    spawn,
    finish,
    waiter,
    sweep,
    turns,
    runs,
    advance: (ms: number) => {
      skew += ms;
    },
    onTurnWrite: (fn: () => Promise<void>) => {
      duringTurn = fn;
    },
  };
}

async function cutWhileRunning(
  wait: (ids: string[], signal?: AbortSignal) => Promise<Summary>,
  ids: string[],
): Promise<void> {
  const mesh = new AbortController();
  const pending = wait(ids, mesh.signal);
  await new Promise((resolve) => setTimeout(resolve, 20));
  mesh.abort();
  await pending;
}

const receivedBy = (
  w: ReturnType<typeof world>,
  driver: string,
  id: string,
  answers: Summary[],
): number =>
  answers.filter(
    (a) => a.done.some((d) => d.id === id) || a.failed.some((f) => f.id === id),
  ).length +
  w.turns.filter((t) => t.agentId === driver && t.ids.includes(id)).length;

describe("a wait the mesh cuts", () => {
  // TEST_SCENARIO: another Agent is created while the driver waits, so the mesh cuts the open call; the agent calls again soon after, as the tool tells it to, and must get the result there, with no turn beside it.
  it("hands the result to the agent's next call, and the sweep writes no turn", async () => {
    const w = world();
    w.spawn("agent-child", "agent-root");
    const wait = w.waiter("agent-root");
    await cutWhileRunning(wait, ["agent-child"]);
    w.finish("agent-child", { status: "done", result: 42 });
    w.advance(WITHIN_GRACE_MS);
    await w.sweep();
    const again = await wait(["agent-child"]);
    w.advance(AFTER_GRACE_MS);
    await w.sweep();
    expect(again.done).toEqual([{ id: "agent-child", result: 42 }]);
    expect(w.turns).toEqual([]);
    expect(receivedBy(w, "agent-root", "agent-child", [again])).toBe(1);
  });

  // TEST_SCENARIO: the harness does not see the cut and calls again only after the grace, so the sweep has written the turn by then; the next wait must name the result as delivered, not return it as a second one.
  it("names a result the turn already carried as delivered on the next call", async () => {
    const w = world();
    w.spawn("agent-child", "agent-root");
    const wait = w.waiter("agent-root");
    await cutWhileRunning(wait, ["agent-child"]);
    w.finish("agent-child", { status: "done", result: 42 });
    w.advance(AFTER_GRACE_MS);
    await w.sweep();
    const again = await wait(["agent-child"]);
    expect(w.turns.map((t) => t.ids)).toEqual([["agent-child"]]);
    expect(again.done).toEqual([]);
    expect(again.delivered).toEqual([{ id: "agent-child" }]);
    expect(receivedBy(w, "agent-root", "agent-child", [again])).toBe(1);
  });

  // TEST_SCENARIO: the agent calls again while a sweep is writing the turn; the run is held by the sweep's lease, so the wait must leave it to the turn.
  it("leaves a result to the turn being written when the wait comes in between", async () => {
    const w = world();
    w.spawn("agent-child", "agent-root");
    const wait = w.waiter("agent-root");
    w.finish("agent-child", { status: "done", result: 42 });
    const answers: Summary[] = [];
    w.onTurnWrite(async () => {
      answers.push(await wait(["agent-child"]));
    });
    await w.sweep();
    expect(answers[0]!.delivered).toEqual([{ id: "agent-child" }]);
    expect(receivedBy(w, "agent-root", "agent-child", answers)).toBe(1);
  });
});

describe("a stopped sub-agent below", () => {
  // TEST_SCENARIO: the user stops a grandchild from the delegation view while the root waits on its child; the grandchild's removal cuts the root's wait, and the child still finishes and reports. The root must get the child's result once, and the grandchild's stop must reach only the child.
  it("gives the root its child's result once, and the stop reaches only the child", async () => {
    const w = world();
    w.spawn("agent-child", "agent-root");
    w.spawn("agent-grandchild", "agent-child");
    const rootWait = w.waiter("agent-root");
    const mesh = new AbortController();
    const pending = rootWait(["agent-child"], mesh.signal);
    w.finish("agent-grandchild", {
      status: "failed",
      errorReason: "stopped by the owner",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    mesh.abort();
    await pending;
    w.advance(AFTER_GRACE_MS);
    await w.sweep();
    w.finish("agent-child", { status: "done", result: "report" });
    w.advance(AFTER_GRACE_MS);
    await w.sweep();
    const again = await rootWait(["agent-child"]);
    const childWait = await w.waiter("agent-child")(["agent-grandchild"]);
    expect(again.delivered).toEqual([{ id: "agent-child" }]);
    expect(receivedBy(w, "agent-root", "agent-child", [again])).toBe(1);
    expect(receivedBy(w, "agent-child", "agent-grandchild", [childWait])).toBe(
      1,
    );
    expect(w.turns.map((t) => t.agentId)).toEqual([
      "agent-child",
      "agent-root",
    ]);
  });
});

describe("a result nobody waits for", () => {
  // TEST_SCENARIO: the driver ended its turn after the spawn and never waits; the result must still arrive, as exactly one turn, however many sweeps run.
  it("arrives as exactly one turn", async () => {
    const w = world();
    w.spawn("agent-child", "agent-root");
    w.finish("agent-child", { status: "done", result: 42 });
    await w.sweep();
    w.advance(AFTER_GRACE_MS);
    await w.sweep();
    expect(w.turns).toHaveLength(1);
    expect(w.turns[0]!.task).toContain("42");
    expect(w.runs.get("agent-child")!.deliveredInTurn).toBe(true);
  });
});
