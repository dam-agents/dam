// TEST_OVERVIEW: The assistant is the ordinary Agent the platform gives a person
// TEST_OVERVIEW: once: created at their first admitted request when the feature is
// TEST_OVERVIEW: on for them, on the default profile and with the greeting's own
// TEST_OVERVIEW: instructions, once however many requests race for it, and never
// TEST_OVERVIEW: again after they delete it. A name they already use is passed
// TEST_OVERVIEW: over rather than taken.
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

/** UNIT_BOUNDARY_DESCRIPTION: the row store as PostgreSQL behaves — the primary key settles `claim`, and `replaceAgent` is a compare-and-set on the Agent id. */
function rowStore(initial?: AssistantRow) {
  const rows = new Map<string, AssistantRow>();
  if (initial) rows.set(initial.owner, initial);
  const repo: AssistantsRepository = {
    find: async (owner) => rows.get(owner) ?? null,
    claim: async (owner, agentId) => {
      if (rows.has(owner)) return false;
      rows.set(owner, { owner, agentId, used: false });
      return true;
    },
    release: async (owner, agentId) => {
      if (rows.get(owner)?.agentId === agentId) rows.delete(owner);
    },
    replaceAgent: async (owner, fromAgentId, toAgentId) => {
      const row = rows.get(owner);
      if (!row || row.agentId !== fromAgentId) return false;
      rows.set(owner, { ...row, agentId: toAgentId, used: false });
      return true;
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

/** UNIT_BOUNDARY_DESCRIPTION: the Agents an owner has, with the store's own create recording what it was asked for. */
function agentStore(existing: readonly string[] = []) {
  const live = new Map<string, InfraAgent>();
  for (const name of existing)
    live.set(`agent-${name}`, {
      id: `agent-${name}`,
      name,
      owner: OWNER,
      spec: { avatar: undefined },
    } as unknown as InfraAgent);
  const create = vi.fn(async (input: { id?: string; name: string }) => {
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

  // TEST_SCENARIO: two requests meet the platform at once; the row's primary key settles which one creates, so there is one Agent between them.
  it("creates one agent when two requests race", async () => {
    const w = service();
    await Promise.all([w.ensure(), w.ensure()]);
    expect(w.agents.create).toHaveBeenCalledTimes(1);
    expect(w.rows.rows.size).toBe(1);
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
    const rows = rowStore({ owner: OWNER, agentId: "agent-gone", used: true });
    const w = service({ rows });
    await w.ensure();
    expect(w.agents.create).not.toHaveBeenCalled();
    expect(w.rows.rows.get(OWNER)).toMatchObject({ agentId: "agent-gone" });
  });

  // TEST_SCENARIO: the create fails before the Agent exists, so the claim is given back and a later request may try again.
  it("gives the claim back when the create fails", async () => {
    const w = service();
    w.agents.create.mockRejectedValueOnce(new Error("apiserver said no"));
    await w.ensure();
    expect(w.rows.rows.size).toBe(0);
    await w.ensure();
    expect(w.agents.create).toHaveBeenCalledTimes(2);
    expect(w.rows.rows.size).toBe(1);
  });
});
