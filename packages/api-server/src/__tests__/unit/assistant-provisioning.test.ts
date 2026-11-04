// TEST_OVERVIEW: Provisioning gives each person one assistant, recorded durably before its Agent is made. The mode and the person's admission decide whether they get one at all; the row's pre-chosen Agent identity makes a retry after a crash, a failed create or an operator's delete finish that same Agent instead of a second one, and makes two replicas converge on it. An Agent of theirs already holding the reserved name is renamed once, and the rename is recorded before it happens, so a create that fails afterwards cannot lose the news. Before either, the owner is enrolled in the Getting Started checklist, so the assistant counts as their first Agent rather than as proof they were here before.
import { describe, expect, it, vi } from "vitest";
import type { Agent } from "api-server-api";
import type { InfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import type {
  AssistantRename,
  AssistantRow,
  AssistantsRepository,
} from "../../modules/assistants/infrastructure/assistants-repository.js";
import {
  createAssistantProvisioner,
  freedName,
} from "../../modules/assistants/services/assistant-provisioner.js";

const ALICE = "alice";
const NAME = "Dambledore";

function agent(id: string, name: string, kind?: Agent["kind"]): Agent {
  return { id, name, ...(kind ? { kind } : {}) } as unknown as Agent;
}

const infra = (a: Agent): InfraAgent =>
  ({ id: a.id, name: a.name, owner: ALICE, kind: a.kind }) as InfraAgent;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the row store as PostgreSQL behaves — the primary
 * key admits one claim, a takeover needs the row to be free or stale, and no
 * call waits for another.
 */
function rowStore() {
  const rows = new Map<string, AssistantRow & { claimedAt: number }>();
  let clock = 0;
  const repo = {
    find: async (owner: string) => rows.get(owner) ?? null,
    reserve: async (owner: string, agentId: string) => {
      if (rows.has(owner)) return false;
      rows.set(owner, {
        owner,
        agentId,
        state: "creating",
        used: false,
        renamed: null,
        noticeSeen: false,
        claimedAt: clock,
      });
      return true;
    },
    takeOver: async (owner: string, agentId: string, staleMs: number) => {
      const row = rows.get(owner);
      if (!row || row.agentId !== agentId) return false;
      if (row.state === "creating" && clock - row.claimedAt < staleMs)
        return false;
      row.claimedAt = clock;
      return true;
    },
    markReady: async (owner: string, agentId: string) => {
      const row = rows.get(owner);
      if (row?.agentId === agentId) row.state = "ready";
    },
    recordRename: async (
      owner: string,
      agentId: string,
      rename: AssistantRename,
    ) => {
      const row = rows.get(owner);
      if (row?.agentId === agentId) row.renamed = rename;
    },
    clearRename: async (owner: string, agentId: string) => {
      const row = rows.get(owner);
      if (row?.agentId === agentId) row.renamed = null;
    },
    markNoticeSeen: async () => undefined,
    markUsed: async () => undefined,
    forgetByAgent: async (agentId: string) => {
      for (const row of rows.values())
        if (row.agentId === agentId) row.state = "gone";
    },
    listAgentIds: async () => [...rows.values()].map((r) => r.agentId),
  } satisfies AssistantsRepository;
  return {
    repo,
    rows,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function world(
  initial: { agents?: Agent[]; enabled?: boolean; admitted?: boolean } = {},
) {
  const store = rowStore();
  const order: string[] = [];
  const state = {
    agents: [...(initial.agents ?? [])],
    order,
    enrolled: vi.fn(async () => {
      order.push("enrolled");
    }),
    created: [] as { id?: string; name: string; kind?: Agent["kind"] }[],
    renamed: [] as { id: string; name: string }[],
    failCreate: false,
  };
  const agents = {
    list: async () => state.agents,
    create: async (input: {
      id?: string;
      name: string;
      kind?: Agent["kind"];
    }) => {
      state.created.push(input);
      order.push("created");
      if (state.failCreate) throw new Error("the storage gate refused");
      const made = agent(
        input.id ?? `agent-new-${state.created.length}`,
        input.name,
        input.kind,
      );
      state.agents = [...state.agents, made];
      return made;
    },
    update: async (patch: { id: string; name?: string }) => {
      state.renamed.push({ id: patch.id, name: patch.name ?? "" });
      order.push("renamed");
      state.agents = state.agents.map((a) =>
        a.id === patch.id ? { ...a, name: patch.name ?? a.name } : a,
      );
      return state.agents.find((a) => a.id === patch.id) ?? null;
    },
  };
  let seq = 0;
  const provisioner = createAssistantProvisioner({
    repo: store.repo,
    ownName: ALICE,
    assistantName: NAME,
    admitted: async () => initial.admitted ?? true,
    enabled: async () => initial.enabled ?? true,
    agentOf: async (agentId) => {
      const found = state.agents.find((a) => a.id === agentId);
      return found ? infra(found) : null;
    },
    agents,
    enrolled: state.enrolled,
    newAgentId: () => `agent-chosen-${(seq += 1)}`,
  });
  return { provisioner, state, store };
}

describe("assistant provisioning", () => {
  // TEST_SCENARIO: with the mode off, or before the person is admitted, nothing is created, nothing is enrolled and no Agent identity is reserved.
  it("creates nothing when the install does not offer assistants", async () => {
    const off = world({ enabled: false });
    await off.provisioner.ensure();
    expect(off.state.created).toEqual([]);
    expect(off.store.rows.size).toBe(0);

    const unadmitted = world({ admitted: false });
    await unadmitted.provisioner.ensure();
    expect(unadmitted.state.created).toEqual([]);
    expect(unadmitted.store.rows.size).toBe(0);
  });

  // TEST_SCENARIO: the first request enrols the owner, records the pre-chosen Agent and creates that exact Agent; the next request finds it settled and does nothing.
  it("creates one assistant with the identity it recorded first", async () => {
    const w = world();
    await w.provisioner.ensure();
    await w.provisioner.ensure();

    expect(w.state.enrolled).toHaveBeenCalledTimes(1);
    expect(w.state.created).toEqual([
      { id: "agent-chosen-1", name: NAME, kind: "assistant" },
    ]);
    expect(w.store.rows.get(ALICE)?.state).toBe("ready");
  });

  // TEST_SCENARIO: a create that fails after the record was written leaves it; the next attempt, once its claim is stale, creates that same Agent rather than a second one.
  it("finishes the same Agent after a failed create", async () => {
    const w = world();
    w.state.failCreate = true;
    await w.provisioner.ensure();
    expect(w.state.created).toHaveLength(1);
    expect(w.store.rows.get(ALICE)?.state).toBe("creating");

    w.state.failCreate = false;
    await w.provisioner.ensure();
    expect(w.state.created).toHaveLength(1);
    expect(w.store.rows.get(ALICE)?.state).toBe("creating");

    w.store.advance(61_000);
    await w.provisioner.ensure();
    expect(w.state.created).toEqual([
      { id: "agent-chosen-1", name: NAME, kind: "assistant" },
      { id: "agent-chosen-1", name: NAME, kind: "assistant" },
    ]);
    expect(w.state.agents.filter((a) => a.kind === "assistant")).toHaveLength(
      1,
    );
    expect(w.store.rows.get(ALICE)?.state).toBe("ready");
  });

  // TEST_SCENARIO: two replicas provisioning the same new owner create one Agent: the loser's claim is refused and it creates nothing.
  it("converges when two replicas race", async () => {
    const w = world();
    const other = createAssistantProvisioner({
      repo: w.store.repo,
      ownName: ALICE,
      assistantName: NAME,
      admitted: async () => true,
      enabled: async () => true,
      agentOf: async (agentId) => {
        const found = w.state.agents.find((a) => a.id === agentId);
        return found ? infra(found) : null;
      },
      agents: {
        list: async () => w.state.agents,
        create: async (input) => {
          w.state.created.push(input);
          const made = agent(input.id ?? "agent-race", input.name, input.kind);
          w.state.agents = [...w.state.agents, made];
          return made;
        },
        update: async () => null,
      },
      enrolled: w.state.enrolled,
      newAgentId: () => "agent-other-replica",
    });

    await Promise.all([w.provisioner.ensure(), other.ensure()]);
    expect(w.state.created).toHaveLength(1);
    expect(w.state.agents.filter((a) => a.kind === "assistant")).toHaveLength(
      1,
    );
  });

  // TEST_SCENARIO: an Agent whose identity the record names is adopted rather than created again, even when the create died after making it.
  it("adopts the Agent it already made", async () => {
    const w = world({ agents: [agent("agent-chosen-1", NAME, "assistant")] });
    await w.provisioner.ensure();
    expect(w.state.created).toEqual([]);
    expect(w.store.rows.get(ALICE)?.state).toBe("ready");
  });

  // TEST_SCENARIO: an Agent that disappeared from under the record (an operator deleted it, or a delete that emptied the record) is made again with the same identity, never a second one.
  it("makes the assistant again when its Agent is gone", async () => {
    const w = world();
    await w.provisioner.ensure();
    w.state.agents = [];
    await w.provisioner.ensure();
    await w.store.repo.forgetByAgent("agent-chosen-1");
    await w.provisioner.ensure();
    expect(w.state.created).toEqual([
      { id: "agent-chosen-1", name: NAME, kind: "assistant" },
      { id: "agent-chosen-1", name: NAME, kind: "assistant" },
    ]);
    expect(w.store.rows.size).toBe(1);
    expect(w.state.agents.map((a) => a.id)).toEqual(["agent-chosen-1"]);
  });

  // TEST_SCENARIO: an Agent the owner already had under the reserved name is renamed to "<name> (yours)", the news is recorded before the rename, and the assistant then takes the name — after the owner is enrolled, so the checklist reads them as new.
  it("renames a clashing Agent once and records the news first", async () => {
    const w = world({ agents: [agent("agent-old", NAME)] });
    await w.provisioner.ensure();

    expect(w.state.order).toEqual(["enrolled", "renamed", "created"]);
    expect(w.state.renamed).toEqual([
      { id: "agent-old", name: `${NAME} (yours)` },
    ]);
    expect(w.store.rows.get(ALICE)?.renamed).toEqual({
      agentId: "agent-old",
      from: NAME,
      to: `${NAME} (yours)`,
    });
    expect(w.state.created[0]?.name).toBe(NAME);
  });

  // TEST_SCENARIO: the rename succeeds and the create then fails: the news is already on the record, the retry keeps it and renames nothing again.
  it("keeps the rename news when the create fails after it", async () => {
    const w = world({ agents: [agent("agent-old", NAME)] });
    w.state.failCreate = true;
    await w.provisioner.ensure();
    expect(w.store.rows.get(ALICE)?.renamed?.to).toBe(`${NAME} (yours)`);

    w.state.failCreate = false;
    w.store.advance(61_000);
    await w.provisioner.ensure();
    expect(w.state.renamed).toHaveLength(1);
    expect(w.store.rows.get(ALICE)?.renamed?.to).toBe(`${NAME} (yours)`);
    expect(w.store.rows.get(ALICE)?.state).toBe("ready");
  });

  // TEST_SCENARIO: a record written before its rename happened is finished on the retry.
  it("finishes a rename the record already describes", async () => {
    const w = world({ agents: [agent("agent-old", NAME)] });
    await w.store.repo.reserve(ALICE, "agent-chosen-1");
    await w.store.repo.recordRename(ALICE, "agent-chosen-1", {
      agentId: "agent-old",
      from: NAME,
      to: `${NAME} (yours)`,
    });
    w.store.advance(61_000);
    await w.provisioner.ensure();
    expect(w.state.renamed).toEqual([
      { id: "agent-old", name: `${NAME} (yours)` },
    ]);
    expect(w.state.created[0]?.name).toBe(NAME);
  });

  // TEST_SCENARIO: the record points at a renamed Agent that is gone, so the news would name nothing; it is dropped and provisioning goes on.
  it("drops the news when the renamed Agent is gone", async () => {
    const w = world();
    await w.store.repo.reserve(ALICE, "agent-chosen-1");
    await w.store.repo.recordRename(ALICE, "agent-chosen-1", {
      agentId: "agent-old",
      from: NAME,
      to: `${NAME} (yours)`,
    });
    w.store.advance(61_000);
    await w.provisioner.ensure();
    expect(w.store.rows.get(ALICE)?.renamed).toBeNull();
    expect(w.store.rows.get(ALICE)?.state).toBe("ready");
  });

  // TEST_SCENARIO: when "<name> (yours)" is taken too, the next free number is used.
  it("numbers the freed name when the first is taken", async () => {
    const w = world({
      agents: [
        agent("agent-old", NAME),
        agent("agent-other", `${NAME} (yours)`),
        agent("agent-third", `${NAME} (yours) 2`),
      ],
    });
    await w.provisioner.ensure();
    expect(w.state.renamed).toEqual([
      { id: "agent-old", name: `${NAME} (yours) 3` },
    ]);
  });
});

describe("freedName", () => {
  it("takes the bracketed name, then numbers it", () => {
    expect(freedName(NAME, new Set())).toBe(`${NAME} (yours)`);
    expect(freedName(NAME, new Set([`${NAME} (yours)`]))).toBe(
      `${NAME} (yours) 2`,
    );
  });
});
