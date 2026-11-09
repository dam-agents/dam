// TEST_OVERVIEW: The assistant is the ordinary Agent the platform gives a person
// TEST_OVERVIEW: once: created at their first admitted request when the feature is
// TEST_OVERVIEW: on for them, on the default profile and with the greeting's own
// TEST_OVERVIEW: instructions, once however many requests race for it, and never
// TEST_OVERVIEW: again after they delete it. A name they already use is passed
// TEST_OVERVIEW: over rather than taken, and a create in flight is adopted rather
// TEST_OVERVIEW: than answered with a second Agent.
import type { Agent } from "api-server-api";
import { describe, expect, it, vi } from "vitest";

import type { InfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import type {
  AssistantRow,
  AssistantsRepository,
} from "../../modules/assistants/infrastructure/assistants-repository.js";
import { createAssistantsService } from "../../modules/assistants/services/assistants-service.js";

const OWNER = "alice";
const NAME = "Dambledore";

/** UNIT_BOUNDARY_DESCRIPTION: the row store as PostgreSQL behaves — the primary key settles `claim`, `markReady` needs the Agent the row names, and `replaceAgent` is a compare-and-set on that Agent. */
function rowStore(initial?: AssistantRow) {
  const rows = new Map<string, AssistantRow>();
  if (initial) rows.set(initial.owner, initial);
  const repo: AssistantsRepository = {
    find: async (owner) => rows.get(owner) ?? null,
    claim: async (owner, agentId) => {
      if (rows.has(owner)) return false;
      rows.set(owner, {
        owner,
        agentId,
        state: "creating",
        used: false,
        resetAt: null,
      });
      return true;
    },
    release: async (owner, agentId) => {
      if (rows.get(owner)?.agentId === agentId) rows.delete(owner);
    },
    markReady: async (owner, agentId) => {
      const row = rows.get(owner);
      if (row?.agentId === agentId) rows.set(owner, { ...row, state: "ready" });
    },
    replaceAgent: async (owner, fromAgentId, toAgentId) => {
      const row = rows.get(owner);
      if (!row || row.agentId !== fromAgentId) return false;
      rows.set(owner, {
        ...row,
        agentId: toAgentId,
        state: "creating",
        used: false,
        resetAt: null,
      });
      return true;
    },
    usageOf: async (agentId) => {
      for (const row of rows.values())
        if (row.agentId === agentId)
          return { owner: row.owner, used: row.used, resetAt: null };
      return null;
    },
    markUsed: async (agentId) => {
      for (const [owner, row] of rows)
        if (row.agentId === agentId) rows.set(owner, { ...row, used: true });
    },
    resetUsed: async (owner) => {
      const row = rows.get(owner);
      if (row) rows.set(owner, { ...row, used: false });
    },
  };
  return { rows, repo };
}

/** UNIT_BOUNDARY_DESCRIPTION: the Agents an owner has, whose create refuses an id that is already there, as the store does — that refusal is what makes concurrent creates of one Agent converge on it. */
function agentStore(existing: readonly string[] = []) {
  const live = new Map<string, InfraAgent>();
  for (const name of existing)
    live.set(`agent-${name}`, {
      id: `agent-${name}`,
      name,
      owner: OWNER,
      spec: { avatar: undefined },
    } as unknown as InfraAgent);
  let hold: Promise<void> | null = null;
  let held = 0;
  const create = vi.fn(async (input: { id?: string; name: string }) => {
    if (hold !== null && held > 0) {
      held -= 1;
      await hold;
    }
    if (live.has(input.id!)) throw new Error("that agent already exists");
    const agent = {
      id: input.id,
      name: input.name,
      spec: { avatar: undefined },
    } as unknown as Agent;
    live.set(agent.id, {
      ...agent,
      owner: OWNER,
    } as unknown as InfraAgent);
    return agent;
  });
  return {
    live,
    create,
    /** UNIT_BOUNDARY_DESCRIPTION: holds the next N creates at their start, so a test can put a reset in the middle of one. */
    holdNext(n: number): () => void {
      let release = () => {};
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      held = n;
      return () => {
        hold = null;
        release();
      };
    },
    list: async () =>
      [...live.values()].map((agent) => agent as unknown as Agent),
    agentOf: async (agentId: string) => live.get(agentId) ?? null,
  };
}

function service(
  deps: {
    rows?: ReturnType<typeof rowStore>;
    agents?: ReturnType<typeof agentStore>;
    enabled?: boolean;
    admitted?: boolean;
  } = {},
) {
  const rows = deps.rows ?? rowStore();
  const agents = deps.agents ?? agentStore();
  const enrolled = vi.fn(async () => {});
  const provisioned = vi.fn(async () => {});
  const resetChecklist = vi.fn(async () => undefined);
  const { assistants, ensure } = createAssistantsService({
    repo: rows.repo,
    owner: OWNER,
    assistantName: NAME,
    brandName: "DAM",
    enabled: async () => deps.enabled ?? true,
    admitted: async () => deps.admitted ?? true,
    agentOf: agents.agentOf,
    agents: { list: agents.list, create: agents.create },
    enrolled,
    provisioned,
    resetChecklist,
  });
  return {
    rows,
    agents,
    enrolled,
    provisioned,
    resetChecklist,
    assistants,
    ensure,
  };
}

describe("giving a person their assistant", () => {
  // TEST_SCENARIO: the install offers it and the person has it on, so the first admitted request makes one ordinary Agent, named and instructed as the greeting says, with no provider chosen for it so it starts on their default profile.
  it("creates one ordinary agent with the greeting's instructions", async () => {
    const w = service();
    await w.ensure();
    expect(w.agents.create).toHaveBeenCalledTimes(1);
    const input = w.agents.create.mock.calls[0]![0] as unknown as {
      name: string;
      instructions: string;
      kind?: string;
      noDefaultProvider?: boolean;
    };
    expect(input.name).toBe(NAME);
    expect(input.kind).toBeUndefined();
    expect(input.noDefaultProvider).toBeUndefined();
    expect(input.instructions).toContain(
      `I'm ${NAME}, your new personal DAM agent!`,
    );
    expect(w.enrolled).toHaveBeenCalledTimes(1);
    expect(w.provisioned).toHaveBeenCalledTimes(1);
    expect(w.rows.rows.get(OWNER)).toMatchObject({ state: "ready" });
    expect(await w.assistants.state()).toMatchObject({ used: false });
  });

  // TEST_SCENARIO: the feature is off for the person — the install pins it off, or they never opted in — so no Agent, no row and no checklist record is made.
  it("makes nothing when the feature is off for the person", async () => {
    const w = service({ enabled: false });
    await w.ensure();
    expect(w.agents.create).not.toHaveBeenCalled();
    expect(w.rows.rows.size).toBe(0);
    expect(w.provisioned).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the person has not accepted the Terms of Use, so they are not admitted and nothing is made for them.
  it("makes nothing for a person who has not accepted the terms", async () => {
    const w = service({ admitted: false });
    await w.ensure();
    expect(w.agents.create).not.toHaveBeenCalled();
    expect(w.rows.rows.size).toBe(0);
    expect(w.provisioned).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: a person whose Agent is there is answered by that alone — a ready row costs one read, not a Terms-of-Use read and not a create.
  it("leaves a ready assistant alone, and creates nothing with the feature off", async () => {
    const rows = rowStore({
      owner: OWNER,
      agentId: "agent-a",
      state: "ready",
      used: false,
      resetAt: null,
    });
    const agents = agentStore();
    const admitted = vi.fn(async () => false);
    const { ensure } = createAssistantsService({
      repo: rows.repo,
      owner: OWNER,
      assistantName: NAME,
      brandName: "DAM",
      enabled: async () => true,
      admitted,
      agentOf: agents.agentOf,
      agents: { list: agents.list, create: agents.create },
      enrolled: async () => {},
      provisioned: async () => {},
      resetChecklist: async () => undefined,
    });
    await ensure();
    expect(admitted).not.toHaveBeenCalled();
    expect(agents.create).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: two requests meet the platform at once; the row's primary key settles which one creates, so there is one Agent between them.
  it("creates one agent when two requests race", async () => {
    const w = service();
    await Promise.all([w.ensure(), w.ensure()]);
    expect(w.agents.create).toHaveBeenCalledTimes(1);
    expect(w.rows.rows.size).toBe(1);
    expect(w.agents.live.size).toBe(1);
  });

  // TEST_SCENARIO: the owner already has an Agent called Dambledore, so the assistant takes the next free name rather than the one they use.
  it("takes the next free name when the owner already uses it", async () => {
    const w = service({ agents: agentStore([NAME]) });
    await w.ensure();
    expect(w.agents.create).toHaveBeenCalledTimes(1);
    expect(w.agents.create.mock.calls[0]![0]).toMatchObject({
      name: `${NAME} 2`,
    });
  });

  // TEST_SCENARIO: the person deleted their assistant; the row stays, so no later request makes another one.
  it("does not recreate an assistant the person deleted", async () => {
    const rows = rowStore({
      owner: OWNER,
      agentId: "agent-gone",
      state: "ready",
      used: true,
      resetAt: null,
    });
    const w = service({ rows });
    await w.ensure();
    expect(w.agents.create).not.toHaveBeenCalled();
    expect(w.rows.rows.get(OWNER)).toMatchObject({ agentId: "agent-gone" });
  });

  // TEST_SCENARIO: a create failed, so the row still says its Agent is being made; a later request asks for the very same Agent again rather than abandoning it.
  it("retries the same agent after a failed create", async () => {
    const w = service();
    w.agents.create.mockRejectedValueOnce(new Error("apiserver said no"));
    await w.ensure();
    const pending = w.rows.rows.get(OWNER);
    expect(pending).toMatchObject({ state: "creating" });
    await w.ensure();
    expect(w.agents.create).toHaveBeenCalledTimes(2);
    expect(w.agents.create.mock.calls[1]![0]).toMatchObject({
      id: pending!.agentId,
    });
    expect(w.agents.live.size).toBe(1);
  });
});
