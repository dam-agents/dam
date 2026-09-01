/** TEST_OVERVIEW: the delivery worker's workspace-mutation settle hint — the
 *  push that tells watching UIs an agent left preparing-workspace. Settling a
 *  workspace-seed or workspace-command event emits WorkspaceMutationSettled
 *  (which live-hints maps to an agents-topic live event); settling only
 *  non-workspace events, an unsettled workspace event, or an agent with no
 *  resolvable owner emits nothing. Without this hint the state flip is a bare
 *  Postgres stamp — no Agent CR change fires the K8s watch, so a fresh
 *  knowledge base would stay "Preparing workspace" in the UI and its greeting
 *  would never fire (#3409). */
import { describe, it, expect } from "vitest";
import type { Event } from "agent-runtime-api";
import {
  events$,
  EventType,
  type WorkspaceMutationSettled,
} from "../../events.js";
import { createWorkerHandler } from "../../modules/runtime-delivery/services/worker-handler.js";
import type {
  OutboxRepo,
  AgentsRuntimeRepo,
  OutboxRow,
} from "../../modules/runtime-delivery/infrastructure/outbox-repo.js";
import type { AgentRuntimeClient } from "../../modules/runtime-delivery/infrastructure/agent-runtime-client.js";
import type { StateBuilder } from "../../modules/runtime-delivery/services/state-builder.js";
import type { HarnessConfigSnapshotWriter } from "../../modules/runtime-delivery/services/snapshot-writer.js";

const AGENT_ID = "agent-1";
const OWNER = "owner-sub";

const EXPIRES = new Date(Date.now() + 60_000).toISOString();

function installEvent(id: string): Event {
  return {
    id,
    kind: "workspace-command",
    version: 3,
    expiresAt: EXPIRES,
    payload: { command: "true" },
  };
}

function seedEvent(id: string): Event {
  return {
    id,
    kind: "workspace-seed",
    version: 3,
    expiresAt: EXPIRES,
    payload: { url: "https://example.com/repo.git" },
  };
}

function resetEvent(id: string): Event {
  return {
    id,
    kind: "schedule-reset",
    version: 3,
    expiresAt: EXPIRES,
    payload: { scheduleId: "sched-1" },
  };
}

function harness(opts: {
  events: Event[];
  settledEventIds: string[];
  owner?: string | null;
}) {
  const row: OutboxRow = {
    agentId: AGENT_ID,
    version: 3,
    lastEnqueuedAt: new Date(0),
    lastSettledVersion: 2,
    lastAppliedVersion: 2,
    lastAppliedHash: null,
    lastAppliedAt: null,
    applyFailures: [],
    applyAttempts: 0,
  };
  const outboxRepo = {
    getRow: async () => row,
    recordOutcome: async () => ({
      newlyFailed: [],
      recovered: [],
      gaveUp: [],
    }),
  } as unknown as OutboxRepo;
  const agentsRuntimeRepo = {
    get: async () => ({
      runtimeCapabilities: { contributions: [], events: [] },
    }),
  } as unknown as AgentsRuntimeRepo;
  const stateBuilder: StateBuilder = {
    build: async () => ({
      contributions: [],
      hash: "h1",
      events: opts.events,
      droppedContributionKinds: [],
      droppedEventKinds: [],
    }),
  };
  const client: AgentRuntimeClient = {
    applyState: async () => ({
      status: "ok",
      appliedVersion: 3,
      appliedHash: "h1",
      failures: [],
      settledEvents: opts.settledEventIds,
    }),
  } as unknown as AgentRuntimeClient;
  return createWorkerHandler({
    outboxRepo,
    agentsRuntimeRepo,
    stateBuilder,
    agentRunningPort: { isRunning: async () => true },
    snapshotWriter: {} as HarnessConfigSnapshotWriter,
    clientFor: () => client,
    resolveOwner: async () => (opts.owner === undefined ? OWNER : opts.owner),
    log: () => {},
  });
}

async function collectHints(run: () => Promise<void>) {
  const seen: WorkspaceMutationSettled[] = [];
  const sub = events$().subscribe((e) => {
    if (e.type === EventType.WorkspaceMutationSettled) seen.push(e);
  });
  try {
    await run();
  } finally {
    sub.unsubscribe();
  }
  return seen;
}

describe("runtime worker workspace-mutation settle hint", () => {
  it("emits when a settled workspace-command reports the install done", async () => {
    const handler = harness({
      events: [installEvent("kb-install:agent-1:1")],
      settledEventIds: ["kb-install:agent-1:1"],
    });
    const seen = await collectHints(() => handler(AGENT_ID));
    expect(seen).toEqual([
      {
        type: EventType.WorkspaceMutationSettled,
        agentId: AGENT_ID,
        ownerSub: OWNER,
      },
    ]);
  });

  it("emits when a settled workspace-seed reports the clone done", async () => {
    const handler = harness({
      events: [seedEvent("workspace-seed:agent-1:1")],
      settledEventIds: ["workspace-seed:agent-1:1"],
    });
    const seen = await collectHints(() => handler(AGENT_ID));
    expect(seen).toHaveLength(1);
  });

  it("stays quiet when only non-workspace events settle", async () => {
    const handler = harness({
      events: [resetEvent("schedule-reset:agent-1:1")],
      settledEventIds: ["schedule-reset:agent-1:1"],
    });
    const seen = await collectHints(() => handler(AGENT_ID));
    expect(seen).toEqual([]);
  });

  it("stays quiet when the workspace event did not settle (install still running or failed)", async () => {
    const handler = harness({
      events: [installEvent("kb-install:agent-1:1")],
      settledEventIds: [],
    });
    const seen = await collectHints(() => handler(AGENT_ID));
    expect(seen).toEqual([]);
  });

  it("stays quiet when the owner cannot be resolved", async () => {
    const handler = harness({
      events: [installEvent("kb-install:agent-1:1")],
      settledEventIds: ["kb-install:agent-1:1"],
      owner: null,
    });
    const seen = await collectHints(() => handler(AGENT_ID));
    expect(seen).toEqual([]);
  });
});
