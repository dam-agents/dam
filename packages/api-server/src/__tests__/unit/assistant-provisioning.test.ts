// TEST_OVERVIEW: Provisioning gives each person one assistant whose Agent id is derived from the owner and the row's incarnation, so the store's create is the mutex: two replicas converge on one Agent, a retry finishes the same one, and only a genuine deletion moves to a new id so nothing keyed by the old one can reach the replacement. `ready` is written only after the Agent and its initialization returned, so a failure is retried rather than hidden. An Agent of the owner's already holding the reserved name is renamed once, the rename is recorded before it happens and completed only when it lands, and an Agent renamed since is left alone. Before the first create the owner is enrolled in the Getting Started checklist, so the assistant counts as their first Agent rather than as proof they were here before.
import { describe, expect, it, vi } from "vitest";
import type { Agent } from "api-server-api";
import type { InfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import { assistantAgentId } from "../../modules/assistants/domain/agent-id.js";
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
const FIRST = assistantAgentId(ALICE, 1);
const SECOND = assistantAgentId(ALICE, 2);

function agent(id: string, name: string, kind?: Agent["kind"]): Agent {
  return { id, name, ...(kind ? { kind } : {}) } as unknown as Agent;
}

const infra = (a: Agent): InfraAgent =>
  ({ id: a.id, name: a.name, owner: ALICE, kind: a.kind }) as InfraAgent;

/** UNIT_BOUNDARY_DESCRIPTION: the row store as PostgreSQL behaves — the primary key settles `start`, `nextIncarnation` is a compare-and-set on the Agent id, and no call waits for another. */
function rowStore() {
  const rows = new Map<string, AssistantRow>();
  const repo = {
    find: async (owner: string) => rows.get(owner) ?? null,
    start: async (owner: string, agentId: string) => {
      if (rows.has(owner)) return false;
      rows.set(owner, {
        owner,
        incarnation: 1,
        agentId,
        state: "creating",
        used: false,
        renamed: null,
        noticeSeen: false,
      });
      return true;
    },
    nextIncarnation: async (
      owner: string,
      fromAgentId: string,
      toAgentId: string,
    ) => {
      const row = rows.get(owner);
      if (!row || row.agentId !== fromAgentId) return false;
      rows.set(owner, {
        ...row,
        incarnation: row.incarnation + 1,
        agentId: toAgentId,
        state: "creating",
        used: false,
      });
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
      if (row?.agentId === agentId) row.renamed = { ...rename, done: false };
    },
    completeRename: async (owner: string, agentId: string) => {
      const row = rows.get(owner);
      if (row?.agentId === agentId && row.renamed)
        row.renamed = { ...row.renamed, done: true };
    },
    clearRename: async (owner: string, agentId: string) => {
      const row = rows.get(owner);
      if (row?.agentId === agentId && row.renamed) row.renamed = null;
    },
    markNoticeSeen: async () => undefined,
    markUsed: async () => undefined,
    forgetByAgent: async (agentId: string) => {
      for (const row of rows.values())
        if (row.agentId === agentId) row.state = "gone";
    },
    listAgentIds: async () => [...rows.values()].map((r) => r.agentId),
  } satisfies AssistantsRepository;
  return { repo, rows };
}

function world(
  initial: { agents?: Agent[]; enabled?: boolean; admitted?: boolean } = {},
) {
  const store = rowStore();
  const state = {
    agents: [...(initial.agents ?? [])],
    order: [] as string[],
    enrolled: vi.fn(async () => {
      state.order.push("enrolled");
    }),
    created: [] as {
      id?: string;
      name: string;
      kind?: Agent["kind"];
      resume?: boolean;
    }[],
    renamed: [] as { id: string; name: string }[],
    failCreate: false,
    failResume: false,
  };
  const agents = {
    list: async () => state.agents,
    create: async (input: {
      id?: string;
      name: string;
      kind?: Agent["kind"];
      resume?: boolean;
    }) => {
      state.created.push(input);
      if (input.resume) {
        state.order.push("initialized");
        if (state.failResume) throw new Error("the preset seeder refused");
        return (state.agents.find((a) => a.id === input.id) ?? null) as never;
      }
      state.order.push("created");
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
      state.order.push("renamed");
      state.agents = state.agents.map((a) =>
        a.id === patch.id ? { ...a, name: patch.name ?? a.name } : a,
      );
      return state.agents.find((a) => a.id === patch.id) ?? null;
    },
  };
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
  });
  return { provisioner, state, store };
}

describe("assistant provisioning", () => {
  // TEST_SCENARIO: with the mode off, or before the person is admitted, nothing is created, nothing is enrolled and no row is written.
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

  // TEST_SCENARIO: the first request enrols the owner, creates the Agent its id is derived to, initializes it and only then marks it ready; the next request finds it done and does nothing.
  it("creates one assistant under the derived id", async () => {
    const w = world();
    await w.provisioner.ensure();
    await w.provisioner.ensure();

    expect(w.state.enrolled).toHaveBeenCalledTimes(1);
    expect(w.state.created).toEqual([
      { id: FIRST, name: NAME, kind: "assistant" },
    ]);
    expect(w.store.rows.get(ALICE)).toMatchObject({
      agentId: FIRST,
      incarnation: 1,
      state: "ready",
    });
  });

  // TEST_SCENARIO: a create that fails leaves the row unready; the retry creates the same Agent, and the Agent that exists afterwards is never created a second time.
  it("finishes the same Agent after a failed create", async () => {
    const w = world();
    w.state.failCreate = true;
    await w.provisioner.ensure();
    expect(w.store.rows.get(ALICE)?.state).toBe("creating");

    w.state.failCreate = false;
    await w.provisioner.ensure();
    expect(w.state.created.map((c) => c.id)).toEqual([FIRST, FIRST]);
    expect(w.store.rows.get(ALICE)?.state).toBe("ready");
    expect(w.state.agents.filter((a) => a.kind === "assistant")).toHaveLength(
      1,
    );
  });

  // TEST_SCENARIO: a create that died after the store write is repaired by re-running its initialization, and only a complete initialization marks it ready.
  it("initializes an Agent that was made but not finished", async () => {
    const w = world({ agents: [agent(FIRST, NAME, "assistant")] });
    w.state.failResume = true;
    await w.provisioner.ensure();
    expect(w.state.created).toEqual([
      { id: FIRST, name: NAME, kind: "assistant", resume: true },
    ]);
    expect(w.store.rows.get(ALICE)?.state).toBe("creating");

    w.state.failResume = false;
    await w.provisioner.ensure();
    expect(w.store.rows.get(ALICE)?.state).toBe("ready");
  });

  // TEST_SCENARIO: two replicas provisioning the same new owner make one Agent: both compute the same id, the store refuses the second create, and it initializes the Agent already there instead of making another.
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
          if (input.resume)
            return (w.state.agents.find((a) => a.id === input.id) ??
              null) as never;
          if (w.state.agents.some((a) => a.id === input.id))
            throw new Error("AlreadyExists");
          const made = agent(input.id ?? "agent-race", input.name, input.kind);
          w.state.agents = [...w.state.agents, made];
          return made;
        },
        update: async () => null,
      },
      enrolled: w.state.enrolled,
    });

    await Promise.all([w.provisioner.ensure(), other.ensure()]);
    expect(w.state.agents.filter((a) => a.kind === "assistant")).toHaveLength(
      1,
    );
    expect(w.store.rows.get(ALICE)?.state).toBe("ready");
  });

  // TEST_SCENARIO: an Agent deleted after it was ready is replaced under a new incarnation and a new id, so nothing keyed by the old id reaches the replacement.
  it("moves to a new incarnation when the Agent was deleted", async () => {
    const w = world();
    await w.provisioner.ensure();
    w.state.agents = [];
    await w.store.repo.forgetByAgent(FIRST);
    await w.provisioner.ensure();

    expect(w.state.created.map((c) => c.id)).toEqual([FIRST, SECOND]);
    expect(SECOND).not.toBe(FIRST);
    expect(w.store.rows.get(ALICE)).toMatchObject({
      agentId: SECOND,
      incarnation: 2,
      state: "ready",
    });
  });

  // TEST_SCENARIO: an Agent that disappeared without the row noticing (an operator deleted it) is also a genuine deletion, so it gets a new id too.
  it("moves to a new incarnation when its Agent vanished", async () => {
    const w = world();
    await w.provisioner.ensure();
    w.state.agents = [];
    await w.provisioner.ensure();
    expect(w.state.created.map((c) => c.id)).toEqual([FIRST, SECOND]);
  });

  // TEST_SCENARIO: an Agent the owner already had under the reserved name is renamed to "<name> (yours)" — after being enrolled, before the assistant exists — and the news is completed and published once the rename lands.
  it("renames a clashing Agent once and completes the news", async () => {
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
      done: true,
    });
  });

  // TEST_SCENARIO: the rename lands and the create then fails: the news is already recorded, the retry keeps it, renames nothing twice and finishes the create.
  it("keeps the completed rename when the create fails after it", async () => {
    const w = world({ agents: [agent("agent-old", NAME)] });
    w.state.failCreate = true;
    await w.provisioner.ensure();
    expect(w.store.rows.get(ALICE)?.renamed?.done).toBe(true);

    w.state.failCreate = false;
    await w.provisioner.ensure();
    expect(w.state.renamed).toHaveLength(1);
    expect(w.store.rows.get(ALICE)?.state).toBe("ready");
  });

  // TEST_SCENARIO: a recorded rename that never ran is finished on the retry; one whose target the person renamed since is dropped rather than renaming over them; one whose Agent is gone is dropped too.
  it("reconciles a recorded rename", async () => {
    const pending = world({ agents: [agent("agent-old", NAME)] });
    await pending.store.repo.start(ALICE, FIRST);
    await pending.store.repo.recordRename(ALICE, FIRST, {
      agentId: "agent-old",
      from: NAME,
      to: `${NAME} (yours)`,
      done: false,
    });
    await pending.provisioner.ensure();
    expect(pending.state.renamed).toEqual([
      { id: "agent-old", name: `${NAME} (yours)` },
    ]);
    expect(pending.store.rows.get(ALICE)?.renamed?.done).toBe(true);

    const sinceRenamed = world({
      agents: [agent("agent-old", "Their own name")],
    });
    await sinceRenamed.store.repo.start(ALICE, FIRST);
    await sinceRenamed.store.repo.recordRename(ALICE, FIRST, {
      agentId: "agent-old",
      from: NAME,
      to: `${NAME} (yours)`,
      done: false,
    });
    await sinceRenamed.provisioner.ensure();
    expect(sinceRenamed.state.renamed).toEqual([]);
    expect(sinceRenamed.store.rows.get(ALICE)?.renamed).toBeNull();

    const goneAgent = world();
    await goneAgent.store.repo.start(ALICE, FIRST);
    await goneAgent.store.repo.recordRename(ALICE, FIRST, {
      agentId: "agent-old",
      from: NAME,
      to: `${NAME} (yours)`,
      done: false,
    });
    await goneAgent.provisioner.ensure();
    expect(goneAgent.store.rows.get(ALICE)?.renamed).toBeNull();
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

describe("assistantAgentId", () => {
  // TEST_SCENARIO: every replica computes the same id for the same owner and incarnation, it has the shape of an Agent id, and the next incarnation is another one.
  it("derives a stable Agent id per owner and incarnation", () => {
    expect(assistantAgentId(ALICE, 1)).toBe(FIRST);
    expect(assistantAgentId(ALICE, 1)).toMatch(/^agent-[0-9a-f]{16}$/);
    expect(assistantAgentId(ALICE, 2)).not.toBe(FIRST);
    expect(assistantAgentId("bob", 1)).not.toBe(FIRST);
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
