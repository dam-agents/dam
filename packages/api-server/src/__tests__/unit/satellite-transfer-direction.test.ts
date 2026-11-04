import { describe, expect, it } from "vitest";
import type { SatelliteTool } from "api-server-api";
import type { JobRow } from "../../modules/satellites/domain/types.js";
import { createSatelliteAgentOps } from "../../modules/satellites/services/agent-ops.js";
import { createSatelliteWorkerOps } from "../../modules/satellites/services/worker-ops.js";

/**
 * TEST_OVERVIEW: Which way a Job may move a file is decided once, when the
 * Agent's call is admitted against the Snapshot that accepted it, and stored on
 * the Job. A Satellite registers its tool list again on every reconnect, so a
 * direction read from the live manifest at transfer time is a direction the
 * machine can change under a Job the Agent already made: a granted download
 * would become an upload of the same Job's arguents. These specs pin that the
 * direction is frozen at admission and that the claim's transfer token follows
 * that frozen value rather than any later tool list.
 */

const NOW = new Date("2026-11-03T10:00:00Z");

const TOOLS: SatelliteTool[] = [
  { name: "download", inputSchema: {}, transfer: "download" },
  { name: "upload", inputSchema: {}, transfer: "upload" },
  { name: "run", inputSchema: {} },
];

function satellite(tools: SatelliteTool[] = TOOLS) {
  return {
    owner: "alice",
    name: "laptop",
    description: null,
    host: null,
    maxConcurrent: 4,
    tools,
    draining: false,
    lastSeenAt: NOW,
    incarnation: "11111111-1111-4111-8111-111111111111",
  };
}

function job(overrides: Partial<JobRow> = {}): JobRow {
  return {
    owner: "alice",
    satellite: "laptop",
    sequence: 1,
    agentId: "agent-1",
    tool: "download",
    args: { path: "logs/app.log" },
    transferDirection: "download",
    status: "running",
    isError: false,
    exitCode: null,
    output: null,
    images: [],
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
    ...overrides,
  };
}

function admission(tools: SatelliteTool[] = TOOLS) {
  const inserted: { tool: string; transferDirection: unknown }[] = [];
  const ops = createSatelliteAgentOps({
    repo: {
      grantedSatellite: async () => satellite(tools),
      get: async () => satellite(tools),
      activeJobs: async () => [],
      insertJob: async (input: {
        tool: string;
        transferDirection: unknown;
      }) => {
        inserted.push({
          tool: input.tool,
          transferDirection: input.transferDirection,
        });
        return job({ tool: input.tool, sequence: 1 });
      },
    } as never,
    ownerOf: async () => "alice",
    spillLog: async () => null,
    now: () => NOW,
  });
  return { ops, inserted };
}

describe("the direction a Job freezes at admission", () => {
  it("stores the direction the admitted Snapshot declared for that tool", async () => {
    const { ops, inserted } = admission();
    for (const tool of ["download", "upload", "run"]) {
      await ops.start("agent-1", "laptop", tool, { path: "x" });
    }
    expect(inserted).toEqual([
      { tool: "download", transferDirection: "download" },
      { tool: "upload", transferDirection: "upload" },
      { tool: "run", transferDirection: null },
    ]);
  });

  /**
   * TEST_SCENARIO: A call for a tool the admitted Snapshot does not offer never
   * reaches storage at all, so there is no Job whose direction a later manifest
   * could reinterpret.
   */
  it("refuses a call for a tool the Snapshot does not offer", async () => {
    const { ops, inserted } = admission([]);
    await expect(
      ops.start("agent-1", "laptop", "download", { path: "x" }),
    ).rejects.toThrow();
    expect(inserted).toEqual([]);
  });
});

describe("the transfer token a claim is issued", () => {
  function claim(claimed: { job: JobRow; transferToken?: string }[]) {
    const ops = createSatelliteWorkerOps({
      repo: {
        get: async () => satellite(),
        touch: async () => {},
        setDraining: async () => {},
        takeCancellations: async () => [],
        claimQueued: async () => claimed,
      } as never,
      maxConcurrentCeiling: 64,
      deliverOutcome: async () => {},
    });
    return ops.claim("alice", { satellite: "laptop", capacity: 4, waitMs: 0 });
  }

  /**
   * TEST_SCENARIO: The token exists only for a Job whose direction was frozen,
   * because a Job that moves no file has nothing to authorise. A work item
   * without one is what a command or an ordinary MCP call gets.
   */
  it("goes out with the claim that has one, and not at all with one that has none", async () => {
    const [withToken] = await claim([
      { job: job(), transferToken: "f".repeat(64) },
    ]);
    expect(withToken?.transferToken).toBe("f".repeat(64));

    const [without] = await claim([{ job: job({ tool: "run" }) }]);
    expect(without?.transferToken).toBeUndefined();
  });
});
