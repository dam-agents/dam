// TEST_OVERVIEW: Provisioning gives each person one assistant. The mode decides whether they get one at all, the row decides once, and an Agent that disappeared is made again. An Agent of theirs already holding the reserved name is renamed once, to the first free "<name> (yours)" or "<name> (yours) N", and the news is recorded on the row. Before the create the owner is enrolled in the Getting Started checklist, so the assistant counts as their first Agent rather than as proof they were here before.
import { describe, expect, it, vi } from "vitest";
import type { Agent } from "api-server-api";
import type {
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
  return {
    id,
    name,
    ...(kind ? { kind } : {}),
  } as unknown as Agent;
}

function world(initial: {
  agents: Agent[];
  row?: AssistantRow | null;
  enabled?: boolean;
}) {
  const state = {
    agents: [...initial.agents],
    row: initial.row ?? null,
    enrolled: vi.fn(async () => undefined),
    created: [] as Agent[],
    renamed: [] as { id: string; name: string }[],
  };
  const repo: AssistantsRepository = {
    find: async () => state.row,
    async provision(_owner, make) {
      const next = await make(state.row);
      if (next === null) return;
      state.row = {
        owner: ALICE,
        agentId: next.agentId,
        renamed: next.renamed ?? null,
        noticeSeen: false,
      };
    },
    markNoticeSeen: async () => undefined,
    forgetByAgent: async () => undefined,
    listAgentIds: async () => [],
  };
  const agents = {
    list: async () => state.agents,
    create: async (input: { name: string; kind?: Agent["kind"] }) => {
      const made = agent(
        `agent-new-${state.created.length}`,
        input.name,
        input.kind,
      );
      state.created.push(made);
      state.agents = [...state.agents, made];
      return made;
    },
    update: async (patch: { id: string; name?: string }) => {
      state.renamed.push({ id: patch.id, name: patch.name ?? "" });
      state.agents = state.agents.map((a) =>
        a.id === patch.id ? { ...a, name: patch.name ?? a.name } : a,
      );
      return state.agents.find((a) => a.id === patch.id) ?? null;
    },
  };
  const provisioner = createAssistantProvisioner({
    repo,
    ownName: ALICE,
    assistantName: NAME,
    enabled: async () => initial.enabled ?? true,
    agentExists: async (agentId) => state.agents.some((a) => a.id === agentId),
    agents,
    enrolled: state.enrolled,
  });
  return { provisioner, state };
}

describe("assistant provisioning", () => {
  // TEST_SCENARIO: with the mode off, nothing is created and nobody is enrolled.
  it("creates nothing when the install does not offer assistants", async () => {
    const w = world({ agents: [], enabled: false });
    await w.provisioner.ensure();
    expect(w.state.created).toEqual([]);
    expect(w.state.enrolled).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the first request enrolls the owner before creating, then creates one assistant-kind Agent named the reserved name; the next request finds it and does nothing.
  it("creates one assistant, after enrolling the owner", async () => {
    const w = world({ agents: [] });
    await w.provisioner.ensure();
    await w.provisioner.ensure();

    expect(w.state.enrolled).toHaveBeenCalledTimes(1);
    expect(w.state.created).toHaveLength(1);
    expect(w.state.created[0]).toMatchObject({ name: NAME, kind: "assistant" });
    expect(w.state.row?.agentId).toBe(w.state.created[0]?.id);
  });

  // TEST_SCENARIO: an Agent that disappeared from under the row (an operator deleted it) is made again on the next request, still one per owner.
  it("makes the assistant again when its Agent is gone", async () => {
    const w = world({
      agents: [],
      row: {
        owner: ALICE,
        agentId: "agent-gone",
        renamed: null,
        noticeSeen: false,
      },
    });
    await w.provisioner.ensure();
    expect(w.state.created).toHaveLength(1);
    expect(w.state.row?.agentId).toBe(w.state.created[0]?.id);
  });

  // TEST_SCENARIO: an Agent the owner already had under the reserved name is renamed to "<name> (yours)", recorded once, and the assistant then takes the name; a second run renames nothing.
  it("renames a clashing Agent once and records the news", async () => {
    const w = world({ agents: [agent("agent-old", NAME)] });
    await w.provisioner.ensure();

    expect(w.state.renamed).toEqual([
      { id: "agent-old", name: `${NAME} (yours)` },
    ]);
    expect(w.state.row?.renamed).toEqual({
      agentId: "agent-old",
      from: NAME,
      to: `${NAME} (yours)`,
    });
    expect(w.state.created[0]?.name).toBe(NAME);
  });

  // TEST_SCENARIO: the second run of a provisioned owner renames nothing, so the news is a one-time event.
  it("renames nothing the second time", async () => {
    const w = world({ agents: [agent("agent-old", NAME)] });
    await w.provisioner.ensure();
    await w.provisioner.ensure();
    expect(w.state.renamed).toHaveLength(1);
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
