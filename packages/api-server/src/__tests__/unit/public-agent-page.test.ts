import { describe, it, expect } from "vitest";
import { emit, EventType } from "../../events.js";
import type {
  PublicAgentProfileLookup,
  PublicAgentProfileRow,
} from "../../modules/agents/infrastructure/public-agent-profile-repository.js";
import {
  createPublicAgentPageService,
  type PublicAgentIdentity,
} from "../../modules/agents/services/public-agent-page-service.js";
import { createPublicAgentProfileReconcileService } from "../../modules/agents/services/public-agent-profile-reconcile-service.js";
import { startPersistPublicAgentProfileSaga } from "../../modules/agents/sagas/persist-public-agent-profile.js";

/**
 * TEST_OVERVIEW: The Public Agent Page reads an agent's name and owner for a
 * visitor with no login. The projection in Postgres is what it reads, so the
 * specs pin four things: the page tells a stranger nothing about which agents
 * exist (unknown, unbound, deleted and failed all answer the same), public
 * traffic reaches the K8s API at most once per agent, only a bound agent ever
 * gets a row, and the owner's name is a display detail that never fails the
 * page.
 */

type ProfileStore = Map<string, PublicAgentProfileRow & { deleted: boolean }>;

function harness(options: {
  boundAgentIds?: string[];
  k8sAgents?: Record<string, PublicAgentIdentity>;
  profiles?: PublicAgentProfileRow[];
  ownerNames?: Record<string, string>;
  directoryThrows?: boolean;
  k8sThrows?: boolean;
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
    getProfile: async (agentId: string): Promise<PublicAgentProfileLookup> => {
      const row = profiles.get(agentId);
      if (!row) return { status: "missing" };
      if (row.deleted) return { status: "deleted" };
      const { deleted: _deleted, ...profile } = row;
      return { status: "live", row: profile };
    },
    upsertProfile: async (row: PublicAgentProfileRow) => {
      profiles.set(row.agentId, { ...row, deleted: false });
    },
    tombstoneProfile: async (agentId: string) => {
      const row = profiles.get(agentId);
      if (row) row.deleted = true;
      else
        profiles.set(agentId, {
          agentId,
          name: "",
          ownerSub: "",
          deleted: true,
        });
    },
    retireProfile: async (agentId: string) => {
      const row = profiles.get(agentId);
      if (row) row.deleted = true;
    },
    listProfileIds: async () =>
      [...profiles.values()]
        .filter((r) => !r.deleted && bound.has(r.agentId))
        .map((r) => r.agentId),
  };

  const readAgent = async (agentId: string) => {
    k8sReads++;
    if (options.k8sThrows) throw new Error("k8s api unreachable");
    return k8sAgents[agentId] ?? null;
  };

  const resolveOwnerName = async (ownerSub: string) => {
    if (options.directoryThrows) throw new Error("keycloak down");
    return options.ownerNames?.[ownerSub] ?? null;
  };

  const logs: string[] = [];
  const log = (m: string) => logs.push(m);

  const service = createPublicAgentPageService({
    ...repo,
    readAgent,
    resolveOwnerName,
    log,
  });

  const reconcileService = createPublicAgentProfileReconcileService({
    ...repo,
    readAgent,
    log,
  });

  const startSaga = () =>
    startPersistPublicAgentProfileSaga({
      hasAnyBinding: repo.hasAnyBinding,
      readAgent,
      upsertProfile: repo.upsertProfile,
      tombstoneProfile: repo.tombstoneProfile,
      retireProfile: repo.retireProfile,
      log,
    });

  return {
    service,
    reconcile: () => reconcileService.reconcile(),
    startSaga,
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
   * TEST_SCENARIO: A binding can outlive the agent it points at — channel
   * cleanup swallows its own delete failure, so the channels row stays after the
   * agent is gone. The first view finds no agent and writes a tombstone, so this
   * endpoint spends one K8s read on that id, not one read per view.
   */
  it("tombstones a bound agent K8s no longer has and reads K8s only once", async () => {
    const h = harness({ boundAgentIds: ["agent-1"] });

    expect(await h.service.get("agent-1")).toBeNull();
    expect(h.storedProfile("agent-1")).toMatchObject({ deleted: true });

    expect(await h.service.get("agent-1")).toBeNull();
    expect(await h.service.get("agent-1")).toBeNull();
    expect(h.k8sReads()).toBe(1);
  });

  /**
   * TEST_SCENARIO: The saga and the reconcile retire rows behind the page's
   * back. A view of a retired row answers the same null as an unknown id and
   * never falls back to K8s, which would name the agent again.
   */
  it("answers null for a tombstoned row without reading K8s", async () => {
    const h = harness({
      boundAgentIds: ["agent-1"],
      profiles: [{ agentId: "agent-1", name: "Scout", ownerSub: "sub-1" }],
    });
    await h.repo.retireProfile("agent-1");

    expect(await h.service.get("agent-1")).toBeNull();
    expect(h.k8sReads()).toBe(0);
  });

  /**
   * TEST_SCENARIO: The K8s API can fail on its own while Postgres is healthy,
   * and only a bound agent with no row ever reaches it. If that failure escaped
   * the route it would answer 500 for those ids and 200 for every other id,
   * which tells a prober which ids are real.
   */
  it("answers the generic page when the K8s read fails", async () => {
    const h = harness({ boundAgentIds: ["agent-1"], k8sThrows: true });

    expect(await h.service.get("agent-1")).toBeNull();
    expect(h.logs.some((m) => m.includes("agent-1"))).toBe(true);
  });

  /**
   * TEST_SCENARIO: A failed read says nothing about whether the agent exists.
   * A tombstone written on it would blank a live agent's page for good, so the
   * next view has to reach K8s again instead.
   */
  it("does not tombstone an agent whose K8s read failed", async () => {
    const h = harness({ boundAgentIds: ["agent-1"], k8sThrows: true });

    await h.service.get("agent-1");

    expect(h.storedProfile("agent-1")).toBeNull();
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
  it("writes the row for a bound agent on create, update and slack connect", async () => {
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
        boundAgentIds: ["agent-1"],
        k8sAgents: { "agent-1": { name: "Scout", ownerSub: "sub-1" } },
      });
      const sub = h.startSaga();

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
   * TEST_SCENARIO: Most agents in an install are never connected to a channel,
   * and the page never names one of those. A row for each of them would still
   * cost the hourly reconcile one control-plane read, so create and update skip
   * an agent with no binding.
   */
  it("writes no row for an agent with no channel binding", async () => {
    const h = harness({
      k8sAgents: { "agent-1": { name: "Scout", ownerSub: "sub-1" } },
    });
    const sub = h.startSaga();

    emit({
      type: EventType.AgentCreated,
      agentId: "agent-1",
      ownerSub: "sub-1",
    });
    emit({ type: EventType.AgentUpdated, agentId: "agent-1" });
    await flushMicrotasks();
    sub.unsubscribe();

    expect(h.profileIds()).toEqual([]);
    expect(h.k8sReads()).toBe(0);
  });

  /**
   * TEST_SCENARIO: A bind is the moment an agent becomes publicly reachable, so
   * it warms the row without asking whether a binding exists — the event is the
   * binding, and the channels row it comes from may not be visible yet.
   */
  it("writes the row on slack connect without a binding lookup", async () => {
    const h = harness({
      k8sAgents: { "agent-1": { name: "Scout", ownerSub: "sub-1" } },
    });
    const sub = h.startSaga();

    emit({
      type: EventType.SlackConnected,
      agentId: "agent-1",
      slackChannelId: "C1",
    });
    await flushMicrotasks();
    sub.unsubscribe();

    expect(h.storedProfile("agent-1")).toMatchObject({ name: "Scout" });
  });

  /**
   * TEST_SCENARIO: A deleted agent must stop being named, and a stale link to
   * it has to keep landing on the generic page rather than a 404.
   */
  it("marks the row deleted on AgentDeleted", async () => {
    const h = harness({
      profiles: [{ agentId: "agent-1", name: "Scout", ownerSub: "sub-1" }],
    });
    const sub = h.startSaga();

    emit({ type: EventType.AgentDeleted, agentId: "agent-1" });
    await flushMicrotasks();
    sub.unsubscribe();

    expect(h.storedProfile("agent-1")).toMatchObject({ deleted: true });
    expect(h.k8sReads()).toBe(0);
  });

  /**
   * TEST_SCENARIO: Most agents are deleted without ever having a row, and
   * nothing in this system removes one, so a tombstone per delete would grow the
   * table for the life of the install. The delete only flips a row that exists.
   * The one id that can still be viewed after the delete - a channels row left
   * behind by a failed cleanup - costs one K8s read, because the first view
   * writes the tombstone itself.
   */
  it("inserts no row on AgentDeleted when there is none to flip", async () => {
    const h = harness({ boundAgentIds: ["agent-1"] });
    const sub = h.startSaga();

    emit({ type: EventType.AgentDeleted, agentId: "agent-1" });
    await flushMicrotasks();
    sub.unsubscribe();

    expect(h.profileIds()).toEqual([]);
    expect(h.k8sReads()).toBe(0);

    expect(await h.service.get("agent-1")).toBeNull();
    expect(await h.service.get("agent-1")).toBeNull();
    expect(h.k8sReads()).toBe(1);
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
      boundAgentIds: ["agent-1", "agent-2"],
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
   * TEST_SCENARIO: Releasing a binding leaves the row behind, and the page stops
   * naming that agent anyway. Refreshing it would spend a control-plane read an
   * hour on an agent nobody can reach, so the walk stays inside bound agents.
   */
  it("skips a row whose channel binding is gone", async () => {
    const h = harness({
      profiles: [{ agentId: "agent-1", name: "Scout", ownerSub: "sub-1" }],
      k8sAgents: { "agent-1": { name: "Scout", ownerSub: "sub-1" } },
    });

    expect(await h.reconcile()).toMatchObject({ scanned: 0 });
    expect(h.k8sReads()).toBe(0);
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
