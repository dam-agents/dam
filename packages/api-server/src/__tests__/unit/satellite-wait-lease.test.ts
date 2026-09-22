import { describe, expect, it } from "vitest";
import { createSatelliteAgentOps } from "../../modules/satellites/services/agent-ops.js";
import type { JobRow } from "../../modules/satellites/domain/types.js";

/**
 * TEST_OVERVIEW: The wait lease, which is how an Agent already sitting in a
 * wait keeps outcome delivery from also waking it about the same Job. The lease
 * withholds an outcome, so who may take one is a security question rather than
 * a tidiness one: a lease written on another Agent's Job would stop that Agent
 * ever being told its command finished. These specs pin that every write in the
 * wait path names the Agent it is for, that the lease is taken before anything
 * is read — a read first is a window delivery can claim in — and that a waiter
 * which loses the claim does not sit on a lease it no longer owns.
 *
 * The fake repository below enforces exactly what the real table's predicate
 * enforces: a write lands only on a row whose agent matches. A repository that
 * dropped that predicate would let these specs write to the other Agent's Job,
 * and they would fail — which is what makes them worth having.
 */

const NOW = new Date("2026-09-22T12:00:00Z");

function job(patch: Partial<JobRow> = {}): JobRow {
  return {
    owner: "alice",
    satellite: "gpu-box",
    sequence: 7,
    agentId: "agent-1",
    tool: "run",
    args: { cmd: ["./process.sh", "sales.db"] },
    status: "running",
    approvalId: null,
    approved: false,
    isError: false,
    exitCode: null,
    output: null,
    truncated: false,
    reason: null,
    cancelRequested: false,
    cancelSentAt: null,
    deliveredAt: null,
    wokeAt: null,
    awaitedUntil: null,
    startedAt: NOW,
    endedAt: null,
    createdAt: NOW,
    ...patch,
  };
}

function harness(rows: JobRow[]) {
  const calls: string[] = [];
  const byKey = new Map(rows.map((r) => [`${r.satellite}#${r.sequence}`, r]));
  const owned = (agentId: string, satellite: string, sequence: number) => {
    const row = byKey.get(`${satellite}#${sequence}`);
    return row !== undefined && row.agentId === agentId ? row : null;
  };
  const repo = {
    grantedNames: async () => [{ owner: "alice", name: "gpu-box" }],
    get: async () => ({
      owner: "alice",
      name: "gpu-box",
      description: null,
      host: null,
      maxConcurrent: 16,
      tools: [{ name: "run", inputSchema: {} }],
      draining: false,
      lastSeenAt: NOW,
    }),
    getJob: async (_o: string, s: string, q: number) => {
      calls.push("getJob");
      return byKey.get(`${s}#${q}`) ?? null;
    },
    markAwaited: async (a: string, s: string, q: number, until: Date) => {
      calls.push(`markAwaited:${a}`);
      const row = owned(a, s, q);
      if (row === null || row.deliveredAt !== null) return false;
      row.awaitedUntil = until;
      return true;
    },
    releaseAwaited: async (a: string, s: string, q: number) => {
      calls.push(`releaseAwaited:${a}`);
      const row = owned(a, s, q);
      if (row !== null) row.awaitedUntil = null;
    },
    markSeen: async (a: string, s: string, q: number) => {
      calls.push(`markSeen:${a}`);
      const row = owned(a, s, q);
      if (row === null || row.deliveredAt !== null) return false;
      row.deliveredAt = NOW;
      return true;
    },
  };
  const ops = createSatelliteAgentOps({
    repo: repo as never,
    ownerOf: async () => "alice",
    spillLog: async () => null,
    retireApproval: async () => {},
    now: () => NOW,
  });
  return { ops, calls, byKey };
}

describe("the wait lease", () => {
  /**
   * TEST_SCENARIO: Two Agents are granted the same Satellite, so both reach
   * `wait` on it. One asks about a Job belonging to the other. The read refuses
   * it, but the lease is written before that read — so if the write is not
   * itself agent-scoped, the refused caller has still withheld the owner's
   * outcome, and the owner is never woken about its own finished command.
   */
  it("cannot be taken on another agent's job, even though the read runs after it", async () => {
    const other = job({ agentId: "agent-2" });
    const { ops, byKey } = harness([other]);

    await expect(ops.wait("agent-1", "gpu-box", 7, 0)).rejects.toThrow();

    expect(
      byKey.get("gpu-box#7")?.awaitedUntil,
      "a refused waiter must not withhold the owning agent's outcome",
    ).toBeNull();
  });

  /**
   * TEST_SCENARIO: Delivery claims an outcome in the window before a waiter
   * takes its lease. The waiter still returns the outcome — it was asked a
   * direct question — but a turn already carries it, so holding the lease would
   * park a Job nobody is waiting on behind a claim nobody owns.
   */
  it("is released when the waiter loses the claim to delivery", async () => {
    const claimed = job({ status: "done", exitCode: 0, endedAt: NOW });
    const { ops, calls, byKey } = harness([claimed]);
    claimed.awaitedUntil = new Date(NOW.getTime() + 2000);
    claimed.deliveredAt = NOW;

    const outcome = await ops.wait("agent-1", "gpu-box", 7, 0);

    expect(outcome.status).toBe("done");
    expect(calls).toContain("releaseAwaited:agent-1");
    expect(byKey.get("gpu-box#7")?.awaitedUntil).toBeNull();
  });

  /**
   * TEST_SCENARIO: Anything read before the lease is taken is a window in which
   * delivery can claim the outcome, after which both paths report it. The lease
   * is therefore the first statement of the call, ahead of the read that
   * establishes the grant and the ownership.
   */
  it("is taken before anything is read, so delivery has no window to claim in", async () => {
    const { ops, calls } = harness([job()]);
    await ops.wait("agent-1", "gpu-box", 7, 0);
    expect(calls[0]).toBe("markAwaited:agent-1");
    expect(calls).toContain("getJob");
    expect(calls.indexOf("markAwaited:agent-1")).toBeLessThan(
      calls.indexOf("getJob"),
    );
  });
});
