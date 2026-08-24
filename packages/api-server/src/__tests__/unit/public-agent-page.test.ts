import { describe, it, expect } from "vitest";
import { emit, EventType } from "../../events.js";
import type { PublicAgentProfileRow } from "../../modules/agents/infrastructure/public-agent-profile-repository.js";
import {
  createPublicAgentPageService,
  type PublicAgentIdentity,
} from "../../modules/agents/services/public-agent-page-service.js";
import { createPublicAgentProfileReconcileService } from "../../modules/agents/services/public-agent-profile-reconcile-service.js";
import { startPersistPublicAgentProfileSaga } from "../../modules/agents/sagas/persist-public-agent-profile.js";

/**
 * TEST_OVERVIEW: The Public Agent Page reads an agent's name and owner for a
 * visitor with no login. The projection in Postgres is what it reads, so the
 * specs pin three things: the page tells a stranger nothing about which agents
 * exist (unknown, unbound and deleted all answer the same), public traffic
 * reaches the K8s API at most once per agent, and the owner's name is a
 * display detail that never fails the page.
 */

type ProfileStore = Map<string, PublicAgentProfileRow & { deleted: boolean }>;

function harness(options: {
  boundAgentIds?: string[];
  k8sAgents?: Record<string, PublicAgentIdentity>;
  profiles?: PublicAgentProfileRow[];
  ownerNames?: Record<string, string>;
  directoryThrows?: boolean;
}) {
  const bound = new Set(options.boundAgentIds ?? []);
  const k8sAgents = options.k8sAgents ?? {};
  const profiles: ProfileStore = new Map(
    (options.profiles ?? []).map((row) => [
      row.agentId,
      { ...row, deleted: false },
    ]),
  );
  let k8sReads = 0;

  const repo = {
    hasAnyBinding: async (agentId: string) => bound.has(agentId),
    getProfile: async (agentId: string) => {
      const row = profiles.get(agentId);
      if (!row || row.deleted) return null;
      const { deleted: _deleted, ...profile } = row;
      return profile;
    },
    upsertProfile: async (row: PublicAgentProfileRow) => {
      profiles.set(row.agentId, { ...row, deleted: false });
    },
    markProfileDeleted: async (agentId: string) => {
      const row = profiles.get(agentId);
      if (row) row.deleted = true;
    },
    listProfileIds: async () =>
      [...profiles.values()].filter((r) => !r.deleted).map((r) => r.agentId),
  };

  const readAgent = async (agentId: string) => {
    k8sReads++;
    return k8sAgents[agentId] ?? null;
  };

  const resolveOwnerName = async (ownerSub: string) => {
    if (options.directoryThrows) throw new Error("keycloak down");
    return options.ownerNames?.[ownerSub] ?? null;
  };

  const service = createPublicAgentPageService({
    ...repo,
    readAgent,
    resolveOwnerName,
  });

  const logs: string[] = [];
  const reconcileService = createPublicAgentProfileReconcileService({
    ...repo,
    readAgent,
    log: (m) => logs.push(m),
  });

  return {
    service,
    reconcile: () => reconcileService.reconcile(),
    repo,
    readAgent,
    logs,
    k8sReads: () => k8sReads,
    storedProfile: (agentId: string) => profiles.get(agentId) ?? null,
    profileIds: () => [...profiles.keys()],
    bind: (agentId: string) => bound.add(agentId),
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("public agent page service", () => {
  /**
   * TEST_SCENARIO: A stranger pastes an id that was never an agent. The page
   * must answer the same as for a real-but-unbound agent, and must not spend a
   * K8s read on it — the binding check is the cheap gate in front of everything
   * else.
   */
  it("answers null for an unknown id without reading K8s", async () => {
    const h = harness({ boundAgentIds: ["agent-bound"] });

    expect(await h.service.get("agent-unknown")).toBeNull();
    expect(h.k8sReads()).toBe(0);
  });

  /**
   * TEST_SCENARIO: An agent exists but nobody connected it to a channel. It is
   * not publicly reachable, so the page treats it exactly like an unknown id.
   */
  it("answers null for an agent with no channel binding", async () => {
    const h = harness({
      k8sAgents: { "agent-1": { name: "Scout", ownerSub: "sub-1" } },
    });

    expect(await h.service.get("agent-1")).toBeNull();
    expect(h.k8sReads()).toBe(0);
  });

  /**
   * TEST_SCENARIO: The lazy fill is the only backfill for agents bound before
   * this shipped. The first view writes the row; every later view is served
   * from Postgres, which is the whole point of the projection.
   */
  it("fills a missing row on first view and reads K8s only once", async () => {
    const h = harness({
      boundAgentIds: ["agent-1"],
      k8sAgents: { "agent-1": { name: "Scout", ownerSub: "sub-1" } },
      ownerNames: { "sub-1": "Radek Jezek" },
    });

    expect(await h.service.get("agent-1")).toEqual({
      agentId: "agent-1",
      name: "Scout",
      ownerName: "Radek Jezek",
    });
    expect(h.storedProfile("agent-1")).toMatchObject({
      name: "Scout",
      ownerSub: "sub-1",
      deleted: false,
    });

    expect(await h.service.get("agent-1")).toMatchObject({ name: "Scout" });
    expect(h.k8sReads()).toBe(1);
  });

  /**
   * TEST_SCENARIO: The row outlives the agent when a replica dies between the
   * K8s delete and the Postgres write. A view then finds the agent gone, marks
   * the row deleted, and reports the same null as an unknown id.
   */
  it("marks the row deleted and answers null when K8s says the agent is gone", async () => {
    const h = harness({
      boundAgentIds: ["agent-1"],
      profiles: [{ agentId: "agent-1", name: "Scout", ownerSub: "sub-1" }],
    });
    await h.repo.markProfileDeleted("agent-1");

    expect(await h.service.get("agent-1")).toBeNull();
    expect(h.storedProfile("agent-1")).toMatchObject({ deleted: true });
  });

  /**
   * TEST_SCENARIO: The owner's name is a display line, not the page. When the
   * directory is unreachable the page still names the agent.
   */
  it("keeps the agent name when the directory throws", async () => {
    const h = harness({
      boundAgentIds: ["agent-1"],
      profiles: [{ agentId: "agent-1", name: "Scout", ownerSub: "sub-1" }],
      directoryThrows: true,
    });

    expect(await h.service.get("agent-1")).toEqual({
      agentId: "agent-1",
      name: "Scout",
      ownerName: null,
    });
  });

  /**
   * TEST_SCENARIO: A directory record can carry no first or last name at all,
   * and that is not an error either — the page omits the owner line rather than
   * falling back to the owner's email, which is a real mailbox.
   */
  it("answers with a null owner name when the sub resolves to nothing", async () => {
    const h = harness({
      boundAgentIds: ["agent-1"],
      profiles: [{ agentId: "agent-1", name: "Scout", ownerSub: "sub-1" }],
    });

    expect(await h.service.get("agent-1")).toMatchObject({ ownerName: null });
  });
});

describe("public agent profile saga", () => {
  /**
   * TEST_SCENARIO: Neither AgentCreated nor AgentUpdated carries the agent's
   * name, and SlackConnected is the moment the agent becomes publicly
   * reachable. All three therefore read the agent back and write the row, so
   * the first click after a bind is already warm.
   */
  it("writes the row on create, update and slack connect", async () => {
    for (const event of [
      { type: EventType.AgentCreated, agentId: "agent-1", ownerSub: "sub-1" },
      { type: EventType.AgentUpdated, agentId: "agent-1" },
      {
        type: EventType.SlackConnected,
        agentId: "agent-1",
        slackChannelId: "C1",
      },
    ] as const) {
      const h = harness({
        k8sAgents: { "agent-1": { name: "Scout", ownerSub: "sub-1" } },
      });
      const sub = startPersistPublicAgentProfileSaga({
        readAgent: h.readAgent,
        upsertProfile: h.repo.upsertProfile,
        markProfileDeleted: h.repo.markProfileDeleted,
      });

      emit(event);
      await flushMicrotasks();
      sub.unsubscribe();

      expect(h.storedProfile("agent-1")).toMatchObject({
        name: "Scout",
        ownerSub: "sub-1",
        deleted: false,
      });
    }
  });

  /**
   * TEST_SCENARIO: A deleted agent must stop being named, and a stale link to
   * it has to keep landing on the generic page rather than a 404.
   */
  it("marks the row deleted on AgentDeleted", async () => {
    const h = harness({
      profiles: [{ agentId: "agent-1", name: "Scout", ownerSub: "sub-1" }],
    });
    const sub = startPersistPublicAgentProfileSaga({
      readAgent: h.readAgent,
      upsertProfile: h.repo.upsertProfile,
      markProfileDeleted: h.repo.markProfileDeleted,
    });

    emit({ type: EventType.AgentDeleted, agentId: "agent-1" });
    await flushMicrotasks();
    sub.unsubscribe();

    expect(h.storedProfile("agent-1")).toMatchObject({ deleted: true });
    expect(h.k8sReads()).toBe(0);
  });
});

describe("public agent profile reconcile", () => {
  /**
   * TEST_SCENARIO: The event bus is in-process, so a replica that dies between
   * the K8s write and the Postgres write leaves a stale row behind. The
   * reconcile refreshes renamed agents and retires vanished ones.
   */
  it("refreshes renamed agents and retires vanished ones", async () => {
    const h = harness({
      profiles: [
        { agentId: "agent-1", name: "old name", ownerSub: "sub-1" },
        { agentId: "agent-2", name: "Gone", ownerSub: "sub-2" },
      ],
      k8sAgents: { "agent-1": { name: "new name", ownerSub: "sub-1" } },
    });

    expect(await h.reconcile()).toEqual({
      scanned: 2,
      refreshed: 1,
      deleted: 1,
      failed: 0,
    });
    expect(h.storedProfile("agent-1")).toMatchObject({ name: "new name" });
    expect(h.storedProfile("agent-2")).toMatchObject({ deleted: true });
  });

  /**
   * TEST_SCENARIO: The reconcile is not a backfill. It walks the rows that
   * exist, never the bindings, so a bound agent with no row stays for the lazy
   * fill to pick up and the two never race.
   */
  it("never inserts an agent it has no row for", async () => {
    const h = harness({
      boundAgentIds: ["agent-unwritten"],
      k8sAgents: {
        "agent-unwritten": { name: "Scout", ownerSub: "sub-1" },
      },
    });

    expect(await h.reconcile()).toMatchObject({ scanned: 0 });
    expect(h.profileIds()).toEqual([]);
  });
});
