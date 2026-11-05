// TEST_OVERVIEW: Provisioning gives each person one assistant whose Agent id is derived from the owner and the row's incarnation, so the store's create is the mutex: two replicas converge on one Agent, a retry finishes the same one, and only a genuine deletion moves to a new id so nothing keyed by the old one can reach the replacement. `ready` is written only after the Agent and its initialization returned, so a failure is retried rather than hidden. An Agent of the owner's already holding the reserved name is renamed once, the rename is recorded before it happens and completed only when it lands, and an Agent renamed since is left alone. Before the first create the owner is enrolled in the Getting Started checklist, so the assistant counts as their first Agent rather than as proof they were here before.
import { describe, expect, it, vi } from "vitest";
import {
  AGENT_INIT_STEPS,
  type Agent,
  type AgentInitStep,
} from "api-server-api";
import { EventType, events$ } from "../../events.js";
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
const BRAND = "DAM";
const FIRST = assistantAgentId(ALICE, 1);
const SECOND = assistantAgentId(ALICE, 2);

function agent(id: string, name: string, kind?: Agent["kind"]): Agent {
  return { id, name, ...(kind ? { kind } : {}) } as unknown as Agent;
}

const infra = (a: Agent): InfraAgent =>
  ({
    id: a.id,
    name: a.name,
    owner: ALICE,
    kind: a.kind,
    spec: {},
  }) as unknown as InfraAgent;

async function until(reached: () => boolean): Promise<void> {
  while (!reached()) await new Promise((resolve) => setImmediate(resolve));
}

/** UNIT_BOUNDARY_DESCRIPTION: the AgentCreated announcements this test's provisioning makes, so it can tell a recovered Agent's single announcement from a duplicate. */
function announced(): { agents: string[]; stop: () => void } {
  const agents: string[] = [];
  const subscription = events$().subscribe((e) => {
    if (e.type === EventType.AgentCreated) agents.push(e.agentId);
  });
  return { agents, stop: () => subscription.unsubscribe() };
}

/** UNIT_BOUNDARY_DESCRIPTION: the per-owner advisory lock as Postgres behaves — one holder per owner, and a caller that finds it taken returns at once instead of waiting. */
function ownerLock() {
  const held = new Set<string>();
  return {
    held,
    withLock: async <T>(owner: string, work: () => Promise<T>) => {
      if (held.has(owner)) return { ran: false as const };
      held.add(owner);
      try {
        return { ran: true as const, value: await work() };
      } finally {
        held.delete(owner);
      }
    },
  };
}

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
        steps: [],
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
    markInitStep: async (
      owner: string,
      agentId: string,
      step: AgentInitStep,
    ) => {
      const row = rows.get(owner);
      if (!row || row.agentId !== agentId) return;
      if (!row.steps.includes(step)) row.steps = [...row.steps, step];
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
    resetUsed: async () => undefined,
    forgetAll: async (
      owner: string,
      fromAgentId: string,
      toAgentId: string,
    ) => {
      const row = rows.get(owner);
      if (!row || row.agentId !== fromAgentId) return;
      rows.set(owner, {
        ...row,
        incarnation: row.incarnation + 1,
        agentId: toAgentId,
        state: "creating",
        steps: [],
        used: false,
        renamed: null,
        noticeSeen: false,
      });
    },
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
      instructions?: string;
    }[],
    renamed: [] as { id: string; name: string }[],
    recorded: [] as string[],
    ran: [] as string[],
    enabled: initial.enabled ?? true,
    failCreate: false,
    failResume: false,
    onCreate: undefined as (() => Promise<void>) | undefined,
  };
  const agents = {
    list: async () => state.agents,
    create: async (input: {
      id?: string;
      name: string;
      kind?: Agent["kind"];
      resume?: boolean;
      instructions?: string;
      initDone?: readonly AgentInitStep[];
      onInitStep?: (step: AgentInitStep) => Promise<void>;
    }) => {
      // UNIT_BOUNDARY_DESCRIPTION: the step runner the real create has — the steps this version defines, minus the ones the caller recorded, and the instructions only for a create that names them — so the test sees which initialization a create performs, resuming or not.
      const runSteps = async () => {
        for (const step of AGENT_INIT_STEPS)
          if (
            (step !== "instructions" || input.instructions !== undefined) &&
            !(input.initDone ?? []).includes(step)
          ) {
            state.ran.push(step);
            await input.onInitStep?.(step);
          }
      };
      state.created.push(input);
      if (input.resume) {
        state.order.push("initialized");
        if (state.failResume) throw new Error("the preset seeder refused");
        await runSteps();
        return (state.agents.find((a) => a.id === input.id) ?? null) as never;
      }
      state.order.push("created");
      await state.onCreate?.();
      if (state.failCreate) throw new Error("the storage gate refused");
      await runSteps();
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
  const lock = ownerLock();
  const provisioner = createAssistantProvisioner({
    repo: store.repo,
    ownName: ALICE,
    assistantName: NAME,
    brandName: BRAND,
    cliInstall: { harnessUrl: "http://harness.test" },
    admitted: async () => initial.admitted ?? true,
    enabled: async () => state.enabled,
    agentOf: async (agentId) => {
      const found = state.agents.find((a) => a.id === agentId);
      return found ? infra(found) : null;
    },
    agents,
    enrolled: state.enrolled,
    provisioned: async (agent) => {
      state.recorded.push(agent.id);
    },
    withLock: lock.withLock,
  });
  return { provisioner, state, store, lock };
}

// TEST_SCENARIO: a row that was ready before this version defined the instructions step — steps [env, egress, grants] — gets that step on its next request, once: the create resumes, only the missing step runs, the row records it, and the Agent announced when it became ready is not announced again.
it("adds a step a ready row predates, once", async () => {
  const events = announced();
  try {
    const w = world({ agents: [agent(FIRST, NAME, "assistant")] });
    await w.store.repo.start(ALICE, FIRST);
    for (const step of ["env", "egress", "grants"] as const)
      await w.store.repo.markInitStep(ALICE, FIRST, step);
    await w.store.repo.markReady(ALICE, FIRST);

    await w.provisioner.ensure();
    // UNIT_BOUNDARY_DESCRIPTION: the row predates both the instructions and the CLI, so a catch-up applies each once.
    expect(w.state.ran).toEqual(["instructions", "cli"]);
    expect(w.store.rows.get(ALICE)).toMatchObject({
      state: "ready",
      steps: ["env", "egress", "grants", "instructions", "cli"],
    });
    expect(events.agents).toEqual([]);

    // UNIT_BOUNDARY_DESCRIPTION: the next request finds nothing left to apply.
    await w.provisioner.ensure();
    expect(w.state.ran).toEqual(["instructions", "cli"]);
  } finally {
    events.stop();
  }
});

// TEST_SCENARIO: the Agent is created with the standing instructions that tell it what the platform greeted its owner with, naming the assistant and the install's brand and no person, so the assistant that receives the first reply knows the platform opened the conversation.
it("hands the Agent its standing instructions", async () => {
  const w = world();
  await w.provisioner.ensure();
  const instructions = w.state.created[0]?.instructions ?? "";
  expect(instructions).toContain(NAME);
  expect(instructions).toContain(BRAND);
  expect(instructions).toContain("Explain what you can do");
});

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

  // TEST_SCENARIO: the install offers the assistant experimentally and this person has not switched it on: nothing is created, no row is written, and an Agent they already named the reserved name keeps its name.
  it("does nothing until the person opts in", async () => {
    const w = world({ agents: [agent("agent-old", NAME)], enabled: false });
    await w.provisioner.ensure();

    expect(w.state.created).toEqual([]);
    expect(w.state.renamed).toEqual([]);
    expect(w.store.rows.size).toBe(0);
    expect(w.state.agents.map((a) => a.name)).toEqual([NAME]);
  });

  // TEST_SCENARIO: the person switches the assistant on later: the next request provisions it, and only then is the Agent that held the reserved name renamed.
  it("provisions and renames once the person opts in", async () => {
    const w = world({ agents: [agent("agent-old", NAME)], enabled: false });
    await w.provisioner.ensure();
    expect(w.state.created).toEqual([]);
    expect(w.state.renamed).toEqual([]);

    w.state.enabled = true;
    await w.provisioner.ensure();
    expect(w.state.created).toEqual([
      expect.objectContaining({ name: NAME, kind: "assistant" }),
    ]);
    expect(w.state.renamed).toEqual([
      { id: "agent-old", name: `${NAME} (yours)` },
    ]);
    expect(w.store.rows.get(ALICE)).toMatchObject({ state: "ready" });
  });

  // TEST_SCENARIO: the first request enrols the owner, creates the Agent its id is derived to, initializes it and only then marks it ready; the next request finds it done and does nothing.
  it("creates one assistant under the derived id", async () => {
    const w = world();
    await w.provisioner.ensure();
    await w.provisioner.ensure();

    expect(w.state.enrolled).toHaveBeenCalledTimes(1);
    expect(w.state.created).toEqual([
      expect.objectContaining({ id: FIRST, name: NAME, kind: "assistant" }),
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

  // TEST_SCENARIO: a create that died after the store write is repaired by re-running its initialization, and only a complete initialization marks it ready — and the Agent it recovers is announced once, so the checklist and the live hint learn about it.
  it("initializes an Agent that was made but not finished", async () => {
    const events = announced();
    try {
      const w = world({ agents: [agent(FIRST, NAME, "assistant")] });
      w.state.failResume = true;
      await w.provisioner.ensure();
      expect(events.agents).toEqual([]);
      expect(w.state.created).toEqual([
        expect.objectContaining({
          id: FIRST,
          name: NAME,
          kind: "assistant",
          resume: true,
        }),
      ]);
      expect(w.store.rows.get(ALICE)?.state).toBe("creating");

      w.state.failResume = false;
      await w.provisioner.ensure();
      expect(w.store.rows.get(ALICE)?.state).toBe("ready");
      expect(events.agents).toEqual([FIRST]);

      await w.provisioner.ensure();
      expect(events.agents).toEqual([FIRST]);
    } finally {
      events.stop();
    }
  });

  // TEST_SCENARIO: a plain create announces its own Agent, so provisioning adds no second announcement for it.
  it("announces only a recovered create", async () => {
    const events = announced();
    try {
      const w = world();
      await w.provisioner.ensure();
      expect(events.agents).toEqual([]);
    } finally {
      events.stop();
    }
  });

  // TEST_SCENARIO: two workers reach the same owner at once: the lock admits one, the other returns without creating, initializing or recording a rename, and the next request finds the work done.
  it("runs one worker at a time per owner", async () => {
    const w = world({ agents: [agent("agent-old", NAME)] });
    let release!: () => void;
    w.state.onCreate = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const first = w.provisioner.ensure();
    const second = w.provisioner.ensure();
    await until(() => release !== undefined);
    // TEST_SCENARIO: the second worker has already been refused the lock by now; let it finish.
    await second;
    release();
    await first;

    expect(w.state.created).toHaveLength(1);
    expect(w.state.renamed).toHaveLength(1);
    expect(w.state.enrolled).toHaveBeenCalledTimes(1);
    expect(w.store.rows.get(ALICE)?.state).toBe("ready");

    await w.provisioner.ensure();
    expect(w.state.created).toHaveLength(1);
    expect(w.state.renamed).toHaveLength(1);
  });

  // TEST_SCENARIO: two replicas provisioning the same new owner make one Agent: both compute the same id, the store refuses the second create, and it initializes the Agent already there instead of making another.
  it("converges when two replicas race", async () => {
    const w = world();
    const other = createAssistantProvisioner({
      repo: w.store.repo,
      ownName: ALICE,
      assistantName: NAME,
      brandName: BRAND,
      cliInstall: { harnessUrl: "http://harness.test" },
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
      provisioned: async (agent) => {
        w.state.recorded.push(agent.id);
      },
      withLock: w.lock.withLock,
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

  // TEST_SCENARIO: a row that still says creating, with steps recorded for the Agent it lost, is a store write that makes a new Agent: it is told that nothing is initialized, so the replacement gets its network rules and its provider instead of skipping them.
  it("initializes a replaced Agent from the start", async () => {
    const w = world();
    await w.store.repo.start(ALICE, FIRST);
    for (const step of AGENT_INIT_STEPS)
      await w.store.repo.markInitStep(ALICE, FIRST, step);
    w.store.rows.get(ALICE)!.state = "creating";

    await w.provisioner.ensure();
    expect(w.state.created).toEqual([
      expect.objectContaining({ id: FIRST, initDone: [] }),
    ]);
    expect(w.state.ran).toEqual([
      "env",
      "egress",
      "instructions",
      "grants",
      "cli",
    ]);
    expect(w.store.rows.get(ALICE)).toMatchObject({
      state: "ready",
      steps: ["env", "egress", "instructions", "grants", "cli"],
    });
  });

  // TEST_SCENARIO: opting in again after turning the assistant off: the record was forgotten, so the next provisioning makes a new Agent under the new incarnation, from nothing initialized, and the old Agent is never reused.
  it("makes a fresh assistant when the person opts in again", async () => {
    const w = world();
    await w.provisioner.ensure();
    await w.store.repo.forgetAll(ALICE, FIRST, SECOND);
    w.state.agents = [];

    await w.provisioner.ensure();
    expect(w.state.created.map((c) => c.id)).toEqual([FIRST, SECOND]);
    expect(w.state.created[1]).toMatchObject({ id: SECOND, initDone: [] });
    expect(w.state.ran).toEqual([
      "env",
      "egress",
      "instructions",
      "grants",
      "env",
      "egress",
      "instructions",
      "grants",
    ]);
    expect(w.store.rows.get(ALICE)).toMatchObject({
      agentId: SECOND,
      incarnation: 2,
      state: "ready",
      steps: ["env", "egress", "instructions", "grants"],
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
