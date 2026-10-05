import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { InvocationView } from "api-server-api";
import { registerSubAgentTools } from "../../apps/harness-api-server/sub-agent-tools.js";
import type { DriverOps } from "../../apps/harness-api-server/driver-ops.js";

/**
 * TEST_OVERVIEW: The await_subagents long poll. It returns as soon as one id is
 * terminal, or at its deadline with what still runs; an id that is not the
 * caller's answers as unknown. The lease it holds on its ids is short and
 * renewed on every poll, so an id the call stops waiting on is pushed as a turn
 * soon after, and a call whose client aborted collects nothing, so the sweep
 * tells the agent instead of a closed transport.
 */

type Handler = (
  args: { ids: string[] },
  extra: { signal: AbortSignal },
) => Promise<unknown>;

function setup(views: Record<string, InvocationView | null>) {
  const tools = new Map<string, Handler>();
  const server = {
    tool: (name: string, _d: unknown, _shape: unknown, handler: Handler) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  const leases: Date[] = [];
  const collected: string[][] = [];
  let reads = 0;
  const ops = {
    get: async (id: string) => {
      reads++;
      return views[id] ?? null;
    },
  } as unknown as DriverOps;
  registerSubAgentTools(server, {
    ops,
    awaits: {
      markAwaited: async (_ids, until) => {
        leases.push(until);
      },
      markCollected: async (ids) => {
        collected.push(ids);
      },
    },
    waitMs: 60,
    pollMs: 5,
  });
  const wait = tools.get("await_subagents")!;
  return {
    wait: (ids: string[], signal = new AbortController().signal) =>
      wait({ ids }, { signal }).then((r) => JSON.parse(text(r))),
    leases,
    collected,
    reads: () => reads,
    views,
  };
}

function text(result: unknown): string {
  const content = (result as { content: { text: string }[] }).content;
  return content[0]!.text;
}

describe("await_subagents", () => {
  it("returns at once when one id is terminal and collects only the terminal ones", async () => {
    const s = setup({
      "agent-a": { status: "done", result: 42 },
      "agent-b": { status: "running", result: null },
    });
    const summary = await s.wait(["agent-a", "agent-b"]);
    expect(summary.done).toEqual([{ id: "agent-a", result: 42 }]);
    expect(summary.running).toEqual(["agent-b"]);
    expect(s.collected).toEqual([["agent-a"]]);
    expect(s.reads()).toBe(2);
  });

  it("answers an id that is not the caller's as unknown", async () => {
    const s = setup({ "agent-a": { status: "done", result: 1 } });
    const summary = await s.wait(["agent-a", "agent-x"]);
    expect(summary.unknown).toEqual(["agent-x"]);
    expect(s.collected).toEqual([["agent-a"]]);
  });

  it("polls until one finishes, renewing a short lease on each poll", async () => {
    const s = setup({ "agent-a": { status: "running", result: null } });
    setTimeout(() => {
      s.views["agent-a"] = { status: "failed", result: null, errorReason: "x" };
    }, 12);
    const before = Date.now();
    const summary = await s.wait(["agent-a"]);
    expect(summary.failed).toEqual([{ id: "agent-a", reason: "x" }]);
    expect(s.leases.length).toBeGreaterThanOrEqual(2);
    for (const until of s.leases)
      expect(until.getTime() - before).toBeLessThanOrEqual(5 * 4 + 60);
  });

  it("returns at the deadline with what still runs", async () => {
    const s = setup({ "agent-a": { status: "running", result: null } });
    const summary = await s.wait(["agent-a"]);
    expect(summary.running).toEqual(["agent-a"]);
    expect(summary.done).toEqual([]);
    expect(s.collected).toEqual([[]]);
  });

  it("collects nothing when the client aborted the call", async () => {
    const s = setup({ "agent-a": { status: "done", result: 7 } });
    const controller = new AbortController();
    controller.abort();
    const summary = await s.wait(["agent-a"], controller.signal);
    expect(summary.done).toEqual([{ id: "agent-a", result: 7 }]);
    expect(s.collected).toEqual([]);
  });
});
