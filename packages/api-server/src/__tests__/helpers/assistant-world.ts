import type { Agent } from "api-server-api";
import { vi } from "vitest";

import type { InfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import type {
  AssistantRow,
  AssistantsRepository,
} from "../../modules/assistants/infrastructure/assistants-repository.js";
import { createAssistantsService } from "../../modules/assistants/services/assistants-service.js";

export const OWNER = "alice";
export const NAME = "Dambledore";

/** UNIT_BOUNDARY_DESCRIPTION: the record store as PostgreSQL behaves — the primary key settles `claim`, and `replaceAgent` and `pointAt` are what say which Agent the row names. */
export function rowStore(initial?: AssistantRow) {
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
        resetAt: new Date(),
      });
      return true;
    },
    pointAt: async (owner, agentId) => {
      const row = rows.get(owner);
      if (row === undefined) {
        rows.set(owner, {
          owner,
          agentId,
          state: "ready",
          used: false,
          resetAt: null,
        });
        return;
      }
      rows.set(owner, {
        ...row,
        agentId,
        state: "ready",
        ...(row.agentId === agentId
          ? {}
          : { used: false, resetAt: new Date() }),
      });
    },
    usageOf: async (agentId) => {
      for (const row of rows.values())
        if (row.agentId === agentId)
          return { owner: row.owner, used: row.used, resetAt: row.resetAt };
      return null;
    },
    markUsed: async (agentId) => {
      for (const [owner, row] of rows)
        if (row.agentId === agentId) rows.set(owner, { ...row, used: true });
    },
    resetUsed: async (owner) => {
      const row = rows.get(owner);
      if (row) rows.set(owner, { ...row, used: false, resetAt: new Date() });
    },
  };
  return { rows, repo };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Agents an owner has, whose create refuses a name
 * that is already taken as the store does, which is how two callers racing for
 * the same Agent end up with one: the loser reads back what is there.
 */
export function agentStore(initialNames: readonly string[] = []) {
  const live = new Map<string, InfraAgent>();
  let next = 1;
  const add = (id: string, name: string) =>
    live.set(id, {
      id,
      name,
      owner: OWNER,
      spec: { avatar: undefined },
    } as unknown as InfraAgent);
  for (const name of initialNames) add(`agent-seed-${next++}`, name);

  const create = vi.fn(
    async (input: { id?: string; name: string; instructions?: string }) => {
      if ([...live.values()].some((agent) => agent.name === input.name))
        throw new Error(`you already have an agent named "${input.name}"`);
      if (live.has(input.id!)) throw new Error("that agent already exists");
      add(input.id!, input.name);
      return live.get(input.id!) as unknown as Agent;
    },
  );

  return {
    live,
    create,
    list: async () =>
      [...live.values()].map((agent) => agent as unknown as Agent),
    agentOf: async (agentId: string) => live.get(agentId) ?? null,
    /** UNIT_BOUNDARY_DESCRIPTION: the person renames one of their Agents, as the ordinary update does — the platform never does this for them. */
    rename(agentId: string, name: string) {
      const agent = live.get(agentId)!;
      live.set(agentId, { ...agent, name } as unknown as InfraAgent);
    },
    /** UNIT_BOUNDARY_DESCRIPTION: the person deletes one of their Agents; the record behind the assistant keeps naming it. */
    remove(agentId: string) {
      live.delete(agentId);
    },
    ids: () => [...live.keys()],
    named: (name: string) =>
      [...live.values()]
        .filter((agent) => agent.name === name)
        .map((a) => a.id),
  };
}

export function assistantService(
  deps: {
    rows?: ReturnType<typeof rowStore>;
    agents?: ReturnType<typeof agentStore>;
    enabled?: boolean;
    admitted?: boolean;
    assistantName?: string;
  } = {},
) {
  const rows = deps.rows ?? rowStore();
  const agents = deps.agents ?? agentStore();
  const enrolled = vi.fn(async () => {});
  const provisioned = vi.fn(async (_agent: { id: string }) => {});
  const resetChecklist = vi.fn(async () => undefined);
  const service = createAssistantsService({
    repo: rows.repo,
    owner: OWNER,
    assistantName: deps.assistantName ?? NAME,
    brandName: "DAM",
    enabled: async () => deps.enabled ?? true,
    admitted: async () => deps.admitted ?? true,
    agentOf: agents.agentOf,
    agents: { list: agents.list, create: agents.create },
    enrolled,
    provisioned,
    resetChecklist,
  });
  return { rows, agents, enrolled, provisioned, resetChecklist, ...service };
}
