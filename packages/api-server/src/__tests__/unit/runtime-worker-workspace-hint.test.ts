/** TEST_OVERVIEW: the delivery worker's workspace-mutation settle hint — the
 *  push that tells watching UIs an agent left preparing-workspace. Settling a
 *  workspace-seed or workspace-command event emits WorkspaceMutationSettled
 *  (which live-hints maps to an agents-topic live event); so does every other
 *  exit from preparing-workspace: an event that exhausted its delivery
 *  attempts (the repo reports it in eventsGaveUp), and a workspace-mutation
 *  kind the agent's runtime cannot apply (dropped by capability filtering and
 *  stamped undeliverable before dispatch). Settling only non-workspace events,
 *  an unsettled workspace event still under its attempt budget, or an agent
 *  with no resolvable owner emits nothing. Without this hint the state flip is
 *  a bare Postgres stamp — no Agent CR change fires the K8s watch, so a fresh
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
  eventsGaveUp?: { id: string; kind: Event["kind"] }[];
  droppedEventKinds?: string[];
  undeliverableCount?: number;
  onMarkUndeliverable?: (agentId: string, kinds: string[]) => void;
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
      eventsGaveUp: opts.eventsGaveUp ?? [],
    }),
    markEventsUndeliverable: async (agentId: string, kinds: string[]) => {
      opts.onMarkUndeliverable?.(agentId, kinds);
      return opts.undeliverableCount ?? 0;
    },
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
      droppedEventKinds: opts.droppedEventKinds ?? [],
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

  /** TEST_SCENARIO: the install keeps failing until the repo exhausts its
   *  delivery-attempt budget and stamps the event dispatched-with-error. The
   *  agent leaves preparing-workspace even though nothing settled cleanly, so
   *  the hint must fire — otherwise the UI keeps showing "Preparing workspace"
   *  for a state that no longer exists. */
  it("emits when a workspace event gave up its delivery attempts", async () => {
    const handler = harness({
      events: [installEvent("kb-install:agent-1:1")],
      settledEventIds: [],
      eventsGaveUp: [{ id: "kb-install:agent-1:1", kind: "workspace-command" }],
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

  /** TEST_SCENARIO: an agent on an older runtime image never advertises
   *  workspace-command, so capability filtering drops the event before
   *  dispatch and it could never settle. The worker must stamp such events
   *  undeliverable and emit the hint, so the agent does not sit in
   *  preparing-workspace until the event's TTL. */
  it("marks dropped workspace-mutation kinds undeliverable and emits", async () => {
    const marked: { agentId: string; kinds: string[] }[] = [];
    const handler = harness({
      events: [],
      settledEventIds: [],
      droppedEventKinds: ["workspace-command"],
      undeliverableCount: 1,
      onMarkUndeliverable: (agentId, kinds) => marked.push({ agentId, kinds }),
    });
    const seen = await collectHints(() => handler(AGENT_ID));
    expect(marked).toEqual([
      { agentId: AGENT_ID, kinds: ["workspace-command"] },
    ]);
    expect(seen).toHaveLength(1);
  });

  /** TEST_SCENARIO: a dropped kind that is not workspace-mutating (a trigger
   *  for an unsupported kind) keeps today's behavior — left pending until its
   *  TTL, nothing stamped, no hint. */
  it("stays quiet when only non-workspace kinds are dropped", async () => {
    const handler = harness({
      events: [],
      settledEventIds: [],
      droppedEventKinds: ["trigger"],
      undeliverableCount: 0,
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
