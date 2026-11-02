import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  ENVIRONMENT_EXPIRY_DEFAULT_DAYS,
  type Agent,
  type AgentEnvironmentView,
  type AgentsService,
  type EnvironmentEndpoint,
  type EnvironmentView,
} from "api-server-api";
import { securityLog } from "../../../core/security-log.js";
import {
  clampExpiry,
  DAY_MS,
  endpointUrl,
  environmentAgentName,
  environmentHost,
  type EnvironmentRecord,
} from "../domain/environment.js";
import type { EnvironmentsRepository } from "../infrastructure/environments-repository.js";
import { effectiveAccess } from "../domain/gate.js";
import type { MembersRepository } from "../infrastructure/members-repository.js";

export interface EnvironmentsConfig {
  urlTemplate: string | null;
  maxPerAgent: number;
  expiryMaxDays: number;
}

export interface CreateEnvironmentInput {
  name: string;
  endpoints: EnvironmentEndpoint[];
  storage?: string;
  expiresAt?: Date;
  start?: string;
}

export interface UpdateEnvironmentInput {
  expiresAt?: Date;
}

export interface EnvironmentsDeps {
  owner: string;
  repo: EnvironmentsRepository;
  members: MembersRepository;
  editorsOf: (owningAgentId: string) => Promise<string[]>;
  agents: AgentsService;
  config: EnvironmentsConfig;
  startCommand: (agentId: string, command: string) => Promise<void>;
  now?: () => Date;
}

export interface OwningAgentEnvironments {
  create(input: CreateEnvironmentInput): Promise<AgentEnvironmentView>;
  list(): Promise<AgentEnvironmentView[]>;
  update(
    name: string,
    input: UpdateEnvironmentInput,
  ): Promise<AgentEnvironmentView>;
  wake(name: string): Promise<void>;
  delete(name: string): Promise<void>;
}

export interface EnvironmentsServiceImpl {
  forOwningAgent(owningAgentId: string): OwningAgentEnvironments;
  list(owningAgentId: string): Promise<EnvironmentView[]>;
  listAll(): Promise<EnvironmentView[]>;
  agentMembers(owningAgentId: string): Promise<string[]>;
  setAgentMembers(owningAgentId: string, emails: string[]): Promise<string[]>;
  setMembers(id: string, emails: string[]): Promise<EnvironmentView>;
  extend(id: string, expiresAt: Date): Promise<EnvironmentView>;
  delete(id: string): Promise<void>;
  remove(record: EnvironmentRecord, actor: string): Promise<void>;
}

function refuse(
  message: string,
  code: TRPCError["code"] = "BAD_REQUEST",
): never {
  throw new TRPCError({ code, message });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Environments for one owner. An owning Agent
 * creates, lists, changes and deletes its own; the owner lists, extends and
 * deletes them from the app. An Environment is an Agent record that names its
 * owning Agent, on the default image, with no harness, no
 * connections and no default model provider, so nothing in it can act as the
 * owning Agent; a row beside it holds its host label, endpoints and expiry,
 * and the owner alone adds people to one Environment, beside the people of its
 * Agent, whom the owner and the Agent's editors name. A `start` command becomes its first Startup Item through the
 * runtime channel. The owning Agent wakes a sleeping one before it opens the
 * Environment Link, which reaches only a running machine. Deleting one deletes
 * its Agent through the agents service, so the Agent's own cleanup runs too.
 */
export function createEnvironmentsService(
  deps: EnvironmentsDeps,
): EnvironmentsServiceImpl {
  const now = deps.now ?? (() => new Date());

  function view(
    record: EnvironmentRecord,
    agent: Agent | null,
    lists: { members: string[]; agentMemberCount: number },
  ): EnvironmentView {
    return {
      id: record.agentId,
      owningAgentId: record.owningAgentId,
      name: record.name,
      endpoints: record.endpoints.map((e) => ({
        ...e,
        url: endpointUrl(deps.config.urlTemplate, e.name, record.host),
      })),
      members: lists.members,
      agentMemberCount: lists.agentMemberCount,
      expiresAt: record.expiresAt.toISOString(),
      createdAt: record.createdAt.toISOString(),
      state: agent?.state ?? "unknown",
    };
  }

  async function views(
    records: EnvironmentRecord[],
  ): Promise<EnvironmentView[]> {
    const agents = new Map((await deps.agents.list()).map((a) => [a.id, a]));
    const live = records.filter((r) => agents.has(r.agentId));
    const members = await deps.members.ofEnvironments(
      live.map((r) => r.agentId),
    );
    const agentMemberCounts = new Map<string, number>();
    for (const id of new Set(live.map((r) => r.owningAgentId)))
      agentMemberCounts.set(id, (await deps.members.ofAgent(id)).length);
    return live.map((r) =>
      view(r, agents.get(r.agentId) ?? null, {
        members: members.get(r.agentId) ?? [],
        agentMemberCount: agentMemberCounts.get(r.owningAgentId) ?? 0,
      }),
    );
  }

  async function viewOf(
    record: EnvironmentRecord,
    agent: Agent | null,
  ): Promise<EnvironmentView> {
    return view(record, agent, {
      members: await deps.members.ofEnvironment(record.agentId),
      agentMemberCount: (await deps.members.ofAgent(record.owningAgentId))
        .length,
    });
  }

  // UNIT_BOUNDARY_DESCRIPTION: an Environment as its owning agent reads it: how many people besides its owner may open it, never who, since only people decide that, in the app.
  async function forAgent(env: EnvironmentView): Promise<AgentEnvironmentView> {
    const people = effectiveAccess(
      await deps.members.ofAgent(env.owningAgentId),
      env.members,
      await deps.editorsOf(env.owningAgentId),
    );
    return {
      id: env.id,
      owningAgentId: env.owningAgentId,
      name: env.name,
      endpoints: env.endpoints,
      peopleWhoMayOpen: people.length,
      expiresAt: env.expiresAt,
      createdAt: env.createdAt,
      state: env.state,
    };
  }

  async function ownedAgent(id: string): Promise<Agent> {
    const agent = await deps.agents.get(id);
    if (!agent) refuse("no such agent", "NOT_FOUND");
    return agent;
  }

  async function owningAgent(id: string): Promise<Agent> {
    const agent = await deps.agents.get(id);
    if (!agent) refuse("no such agent", "NOT_FOUND");
    if (agent.spec.environmentOf)
      refuse("an Environment cannot own Environments");
    return agent;
  }

  async function ownRecord(id: string): Promise<EnvironmentRecord> {
    const record = await deps.repo.get(id);
    if (!record || record.owner !== deps.owner)
      refuse("no such Environment", "NOT_FOUND");
    return record;
  }

  function expiry(requested: Date | undefined): Date {
    const at =
      requested ??
      new Date(now().getTime() + ENVIRONMENT_EXPIRY_DEFAULT_DAYS * DAY_MS);
    const resolved = clampExpiry(at, now(), deps.config.expiryMaxDays);
    if ("error" in resolved) refuse(resolved.error);
    return resolved;
  }

  async function remove(
    record: EnvironmentRecord,
    actor: string,
  ): Promise<void> {
    await deps.agents.delete(record.agentId);
    await deps.repo.delete(record.agentId);
    securityLog("info", "environment.delete", {
      category: "resource",
      actor,
      actorKind: actor === deps.owner ? "user" : "agent",
      agentId: record.agentId,
      result: "success",
    });
  }

  function forOwningAgent(owningAgentId: string): OwningAgentEnvironments {
    async function createUnder(
      input: CreateEnvironmentInput,
    ): Promise<AgentEnvironmentView> {
      const owning = await owningAgent(owningAgentId);
      if (await deps.repo.findByName(owningAgentId, input.name))
        refuse(`an Environment named ${input.name} already exists`, "CONFLICT");
      const held = await deps.repo.listByOwningAgent(owningAgentId);
      if (held.length >= deps.config.maxPerAgent)
        refuse(
          `this agent already holds ${held.length} Environments, the most it may; delete one first`,
          "PRECONDITION_FAILED",
        );
      const expiresAt = expiry(input.expiresAt);
      const agent = await deps.agents.create({
        name: environmentAgentName(owning.name, input.name),
        description: `Environment ${input.name} of ${owning.name}`,
        environmentOf: owningAgentId,
        noDefaultProvider: true,
        egressPreset: "none",
        requireConnectionAddress: true,
        ...(input.storage ? { storage: input.storage } : {}),
      });
      const record: EnvironmentRecord = {
        agentId: agent.id,
        owningAgentId,
        owner: deps.owner,
        name: input.name,
        host: environmentHost(input.name, randomBytes(3).toString("hex")),
        endpoints: input.endpoints,
        expiresAt,
        createdAt: now(),
      };
      try {
        await deps.repo.insert(record);
        const after = await deps.repo.listByOwningAgent(owningAgentId);
        if (after.length > deps.config.maxPerAgent)
          refuse(
            `this agent already holds ${after.length - 1} Environments, the most it may; delete one first`,
            "PRECONDITION_FAILED",
          );
        if (input.start) await deps.startCommand(agent.id, input.start);
      } catch (err) {
        await deps.agents.delete(agent.id).catch(() => undefined);
        await deps.repo.delete(agent.id).catch(() => undefined);
        throw err;
      }
      securityLog("info", "environment.create", {
        category: "resource",
        actor: owningAgentId,
        actorKind: "agent",
        agentId: agent.id,
        result: "success",
      });
      return forAgent(await viewOf(record, agent));
    }

    async function byName(name: string): Promise<EnvironmentRecord> {
      const record = await deps.repo.findByName(owningAgentId, name);
      if (!record || record.owner !== deps.owner)
        refuse(`no Environment named ${name}`, "NOT_FOUND");
      return record;
    }

    return {
      create: createUnder,

      async list() {
        const all = await views(
          await deps.repo.listByOwningAgent(owningAgentId),
        );
        return Promise.all(all.map(forAgent));
      },

      async update(name, input) {
        if (input.expiresAt === undefined)
          refuse("nothing to change: give an expiry");
        const record = await byName(name);
        const expiresAt = expiry(input.expiresAt);
        await deps.repo.update(record.agentId, { expiresAt });
        return forAgent(
          await viewOf(
            { ...record, expiresAt },
            await deps.agents.get(record.agentId),
          ),
        );
      },

      async wake(name) {
        const woke = await deps.agents.wake((await byName(name)).agentId);
        if (woke.ok) return;
        if (woke.error.type === "AgentDisabled")
          refuse(
            `${name} is turned off by your owner; it does not wake until they turn it on`,
            "PRECONDITION_FAILED",
          );
        refuse(`no Environment named ${name}`, "NOT_FOUND");
      },

      async delete(name) {
        await remove(await byName(name), owningAgentId);
      },
    };
  }

  return {
    forOwningAgent,

    async list(owningAgentId) {
      const records = await deps.repo.listByOwningAgent(owningAgentId);
      return views(records.filter((r) => r.owner === deps.owner));
    },

    async listAll() {
      return views(await deps.repo.listByOwner(deps.owner));
    },

    async agentMembers(owningAgentId) {
      await ownedAgent(owningAgentId);
      return deps.members.ofAgent(owningAgentId);
    },

    async setAgentMembers(owningAgentId, emails) {
      await ownedAgent(owningAgentId);
      const unique = [...new Set(emails)];
      await deps.members.setOfAgent(owningAgentId, unique);
      securityLog("info", "environment.agent_members", {
        category: "authz-list",
        actor: deps.owner,
        actorKind: "user",
        agentId: owningAgentId,
        result: "success",
        detail: { count: unique.length },
      });
      return deps.members.ofAgent(owningAgentId);
    },

    async setMembers(id, emails) {
      const record = await ownRecord(id);
      const unique = [...new Set(emails)];
      await deps.members.setOfEnvironment(id, unique);
      securityLog("info", "environment.members", {
        category: "authz-list",
        actor: deps.owner,
        actorKind: "user",
        agentId: id,
        result: "success",
        detail: { count: unique.length },
      });
      return viewOf(record, await deps.agents.get(id));
    },

    async extend(id, expiresAt) {
      const record = await ownRecord(id);
      const at = expiry(expiresAt);
      await deps.repo.update(id, { expiresAt: at });
      return viewOf({ ...record, expiresAt: at }, await deps.agents.get(id));
    },

    async delete(id) {
      await remove(await ownRecord(id), deps.owner);
    },

    remove,
  };
}
