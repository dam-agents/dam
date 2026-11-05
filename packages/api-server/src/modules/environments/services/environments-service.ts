import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  ENVIRONMENT_EXPIRY_DEFAULT_DAYS,
  type Agent,
  type AgentEnvironmentMembersView,
  type AgentEnvironmentView,
  type AgentsService,
  type EnvironmentAgentLookup,
  type EnvironmentEndpoint,
  type EnvironmentMemberAgent,
  type EnvironmentView,
  type MembersUpdate,
  type SharedEnvironmentView,
} from "api-server-api";
import { securityLog } from "../../../core/security-log.js";
import {
  clampExpiry,
  clampIdleTimeout,
  DAY_MS,
  endpointUrl,
  environmentAgentName,
  environmentHost,
  type EnvironmentRecord,
  type ExpiryRequest,
  type IdleTimeoutRequest,
  NEVER_SLEEPS_MIN,
} from "../domain/environment.js";
import type { EnvironmentsRepository } from "../infrastructure/environments-repository.js";
import { effectiveAccess } from "../domain/gate.js";
import type { MembersRepository } from "../infrastructure/members-repository.js";

export interface EnvironmentsConfig {
  urlTemplate: string | null;
  maxPerAgent: number;
  expiryMaxDays: number;
  idleTimeoutDefaultMin: number;
  idleTimeoutMaxMin: number;
}

export interface CreateEnvironmentInput {
  name: string;
  endpoints: EnvironmentEndpoint[];
  storage?: string;
  expiresAt?: ExpiryRequest;
  idleTimeoutMin?: IdleTimeoutRequest;
  start?: string;
}

export interface UpdateEnvironmentInput {
  expiresAt?: ExpiryRequest;
  idleTimeoutMin?: IdleTimeoutRequest;
  // UNIT_BOUNDARY_DESCRIPTION: readiness paths by endpoint name; null removes one, so the endpoint is ready once its port answers.
  ready?: Record<string, string | null>;
}

// UNIT_BOUNDARY_DESCRIPTION: an Agent of any owner, by its id, as a list shows it: its name, its owner's display name, and whether it is an Environment, which no list may name.
export interface AgentDirectory {
  describe(agentId: string): Promise<{
    name: string;
    ownerName: string | null;
    environment: boolean;
  } | null>;
  // UNIT_BOUNDARY_DESCRIPTION: an Environment's Owning Agent and owner by name, for an Agent it is shared with; the Agents of another owner are read here, never through that owner's agents service.
  environmentState(agentId: string): Promise<string>;
}

export interface EnvironmentsDeps {
  owner: string;
  repo: EnvironmentsRepository;
  members: MembersRepository;
  editorsOf: (owningAgentId: string) => Promise<string[]>;
  directory: AgentDirectory;
  agents: AgentsService;
  config: EnvironmentsConfig;
  startCommand: (agentId: string, command: string) => Promise<void>;
  now?: () => Date;
}

export interface OwningAgentEnvironments {
  idleTimeout: { defaultMin: number; maxMin: number };
  // UNIT_BOUNDARY_DESCRIPTION: whether the Agent may own Environments (its owner has the feature); without it, it only lists those shared with it.
  manage: boolean;
  create(input: CreateEnvironmentInput): Promise<AgentEnvironmentView>;
  list(): Promise<AgentEnvironmentView[]>;
  // UNIT_BOUNDARY_DESCRIPTION: the Environments other Agents' lists share with this Agent, read-only.
  shared(): Promise<SharedEnvironmentView[]>;
  update(
    name: string,
    input: UpdateEnvironmentInput,
  ): Promise<AgentEnvironmentView>;
  wake(name: string): Promise<void>;
  delete(name: string): Promise<void>;
}

export interface EnvironmentsServiceImpl {
  forOwningAgent(
    owningAgentId: string,
    opts?: { manage: boolean },
  ): OwningAgentEnvironments;
  list(owningAgentId: string): Promise<EnvironmentView[]>;
  listAll(): Promise<EnvironmentView[]>;
  agentMembers(owningAgentId: string): Promise<AgentEnvironmentMembersView>;
  setAgentMembers(
    owningAgentId: string,
    update: MembersUpdate,
  ): Promise<AgentEnvironmentMembersView>;
  setMembers(id: string, update: MembersUpdate): Promise<EnvironmentView>;
  lookupAgent(agentId: string): Promise<EnvironmentAgentLookup>;
  extend(id: string, expiresAt: ExpiryRequest): Promise<EnvironmentView>;
  delete(id: string): Promise<void>;
  remove(record: EnvironmentRecord, actor: string): Promise<void>;
}

function withReadyPaths(
  endpoints: EnvironmentEndpoint[],
  ready: Record<string, string | null>,
): EnvironmentEndpoint[] {
  const unknown = Object.keys(ready).filter(
    (name) => !endpoints.some((e) => e.name === name),
  );
  if (unknown.length > 0)
    refuse(`ready: no endpoint named ${unknown.join(", ")}`);
  return endpoints.map(({ ready: kept, ...endpoint }) => {
    const path = Object.hasOwn(ready, endpoint.name)
      ? ready[endpoint.name]
      : kept;
    return path ? { ...endpoint, ready: path } : endpoint;
  });
}

// UNIT_BOUNDARY_DESCRIPTION: the idle timeout a view shows: "never" for an Environment that never sleeps, its minutes otherwise, and null when its Agent is gone.
function idleTimeoutView(agent: Agent | null): number | "never" | null {
  if (!agent) return null;
  return agent.effectiveHibernationTimeoutMin === NEVER_SLEEPS_MIN
    ? "never"
    : agent.effectiveHibernationTimeoutMin;
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
 * its Agent carries the idle timeout it sleeps after; either may be "never",
 * set by the owner or the owning Agent, whoever changed it last,
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
    lists: {
      members: string[];
      memberAgents: EnvironmentMemberAgent[];
      agentMemberCount: number;
    },
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
      memberAgents: lists.memberAgents,
      agentMemberCount: lists.agentMemberCount,
      expiresAt: record.expiresAt?.toISOString() ?? null,
      idleTimeoutMin: idleTimeoutView(agent),
      createdAt: record.createdAt.toISOString(),
      state: agent?.state ?? "unknown",
    };
  }

  // UNIT_BOUNDARY_DESCRIPTION: the Agents on a list as its owner sees them, in the list's order, with when each last opened one of the given Environments; an id whose Agent is gone is left out.
  async function describeAgents(
    agentIds: string[],
    environmentIds: string[],
  ): Promise<EnvironmentMemberAgent[]> {
    if (agentIds.length === 0) return [];
    const opened = await deps.members.lastOpened(environmentIds, agentIds);
    const out: EnvironmentMemberAgent[] = [];
    for (const agentId of agentIds) {
      const described = await deps.directory.describe(agentId);
      if (!described) continue;
      out.push({
        agentId,
        name: described.name,
        ownerName: described.ownerName,
        lastOpenedAt: opened.get(agentId)?.toISOString() ?? null,
      });
    }
    return out;
  }

  async function agentMemberCount(owningAgentId: string): Promise<number> {
    return (
      (await deps.members.ofAgent(owningAgentId)).length +
      (await deps.members.agentsOfAgent(owningAgentId)).length
    );
  }

  async function views(
    records: EnvironmentRecord[],
  ): Promise<EnvironmentView[]> {
    const agents = new Map((await deps.agents.list()).map((a) => [a.id, a]));
    const live = records.filter((r) => agents.has(r.agentId));
    const ids = live.map((r) => r.agentId);
    const members = await deps.members.ofEnvironments(ids);
    const memberAgentIds = await deps.members.agentsOfEnvironments(ids);
    const agentMemberCounts = new Map<string, number>();
    for (const id of new Set(live.map((r) => r.owningAgentId)))
      agentMemberCounts.set(id, await agentMemberCount(id));
    return Promise.all(
      live.map(async (r) =>
        view(r, agents.get(r.agentId) ?? null, {
          members: members.get(r.agentId) ?? [],
          memberAgents: await describeAgents(
            memberAgentIds.get(r.agentId) ?? [],
            [r.agentId],
          ),
          agentMemberCount: agentMemberCounts.get(r.owningAgentId) ?? 0,
        }),
      ),
    );
  }

  async function viewOf(
    record: EnvironmentRecord,
    agent: Agent | null,
  ): Promise<EnvironmentView> {
    return view(record, agent, {
      members: await deps.members.ofEnvironment(record.agentId),
      memberAgents: await describeAgents(
        await deps.members.agentsOfEnvironment(record.agentId),
        [record.agentId],
      ),
      agentMemberCount: await agentMemberCount(record.owningAgentId),
    });
  }

  // UNIT_BOUNDARY_DESCRIPTION: the Agent ids a person saves on a list, each checked to name an Agent that exists and is not an Environment, of any owner; the first that does not refuses the whole list, so nothing is saved that would open nothing.
  async function checkedAgentIds(agentIds: string[]): Promise<string[]> {
    const unique = [...new Set(agentIds.map((id) => id.trim()))];
    for (const id of unique) {
      const described = await deps.directory.describe(id);
      if (!described || described.environment)
        refuse(`${id} is not an agent that can open an Environment`);
    }
    return unique;
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
      expiresAt: env.expiresAt ?? "never",
      idleTimeoutMin: env.idleTimeoutMin,
      createdAt: env.createdAt,
      state: env.state,
    };
  }

  async function agentMembersView(
    owningAgentId: string,
  ): Promise<AgentEnvironmentMembersView> {
    const environmentIds = (
      await deps.repo.listByOwningAgent(owningAgentId)
    ).map((r) => r.agentId);
    return {
      emails: await deps.members.ofAgent(owningAgentId),
      agents: await describeAgents(
        await deps.members.agentsOfAgent(owningAgentId),
        environmentIds,
      ),
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

  function expiry(requested: ExpiryRequest | undefined): Date | null {
    const at =
      requested ??
      new Date(now().getTime() + ENVIRONMENT_EXPIRY_DEFAULT_DAYS * DAY_MS);
    const resolved = clampExpiry(at, now(), deps.config.expiryMaxDays);
    if (resolved !== null && "error" in resolved) refuse(resolved.error);
    return resolved;
  }

  function idleTimeout(requested: IdleTimeoutRequest | undefined): number {
    const resolved = clampIdleTimeout(
      requested,
      deps.config.idleTimeoutDefaultMin,
      deps.config.idleTimeoutMaxMin,
    );
    if (typeof resolved !== "number") refuse(resolved.error);
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

  function forOwningAgent(
    owningAgentId: string,
    opts: { manage: boolean } = { manage: true },
  ): OwningAgentEnvironments {
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
      const hibernationTimeoutMin = idleTimeout(input.idleTimeoutMin);
      const agent = await deps.agents.create({
        name: environmentAgentName(owning.name, input.name),
        description: `Environment ${input.name} of ${owning.name}`,
        environmentOf: owningAgentId,
        noDefaultProvider: true,
        egressPreset: "none",
        requireConnectionAddress: true,
        hibernationTimeoutMin,
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
      idleTimeout: {
        defaultMin: deps.config.idleTimeoutDefaultMin,
        maxMin: deps.config.idleTimeoutMaxMin,
      },
      manage: opts.manage,
      create: createUnder,

      async list() {
        const all = await views(
          await deps.repo.listByOwningAgent(owningAgentId),
        );
        return Promise.all(all.map(forAgent));
      },

      async shared() {
        const ids = await deps.members.environmentsSharedWith(owningAgentId);
        const out: SharedEnvironmentView[] = [];
        for (const id of ids) {
          const record = await deps.repo.get(id);
          if (!record || record.owningAgentId === owningAgentId) continue;
          const owning = await deps.directory.describe(record.owningAgentId);
          if (!owning) continue;
          out.push({
            id: record.agentId,
            name: record.name,
            sharedWithYou: true,
            owningAgentName: owning.name,
            ownerName: owning.ownerName,
            endpoints: record.endpoints.map((e) => ({
              ...e,
              url: endpointUrl(deps.config.urlTemplate, e.name, record.host),
            })),
            expiresAt: record.expiresAt?.toISOString() ?? "never",
            state: await deps.directory.environmentState(record.agentId),
          });
        }
        return out;
      },

      async update(name, input) {
        if (
          input.expiresAt === undefined &&
          input.idleTimeoutMin === undefined &&
          input.ready === undefined
        )
          refuse(
            "nothing to change: give an expiry, an idle timeout or readiness paths",
          );
        const record = await byName(name);
        const patch: Partial<
          Pick<EnvironmentRecord, "expiresAt" | "endpoints">
        > = {};
        if (input.expiresAt !== undefined)
          patch.expiresAt = expiry(input.expiresAt);
        if (input.ready !== undefined)
          patch.endpoints = withReadyPaths(record.endpoints, input.ready);
        const hibernationTimeoutMin =
          input.idleTimeoutMin === undefined
            ? undefined
            : idleTimeout(input.idleTimeoutMin);
        if (Object.keys(patch).length > 0)
          await deps.repo.update(record.agentId, patch);
        const agent =
          hibernationTimeoutMin === undefined
            ? await deps.agents.get(record.agentId)
            : await deps.agents.update({
                id: record.agentId,
                hibernationTimeoutMin,
              });
        return forAgent(await viewOf({ ...record, ...patch }, agent));
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
      return agentMembersView(owningAgentId);
    },

    async setAgentMembers(owningAgentId, update) {
      await ownedAgent(owningAgentId);
      const unique = [...new Set(update.emails)];
      const agentIds =
        update.agentIds === undefined
          ? undefined
          : await checkedAgentIds(update.agentIds);
      await deps.members.setOfAgent(owningAgentId, unique);
      if (agentIds !== undefined)
        await deps.members.setAgentsOfAgent(owningAgentId, agentIds);
      securityLog("info", "environment.agent_members", {
        category: "authz-list",
        actor: deps.owner,
        actorKind: "user",
        agentId: owningAgentId,
        result: "success",
        detail: {
          count: unique.length,
          ...(agentIds !== undefined ? { agents: agentIds } : {}),
        },
      });
      return agentMembersView(owningAgentId);
    },

    async setMembers(id, update) {
      const record = await ownRecord(id);
      const unique = [...new Set(update.emails)];
      const agentIds =
        update.agentIds === undefined
          ? undefined
          : await checkedAgentIds(update.agentIds);
      await deps.members.setOfEnvironment(id, unique);
      if (agentIds !== undefined)
        await deps.members.setAgentsOfEnvironment(id, agentIds);
      securityLog("info", "environment.members", {
        category: "authz-list",
        actor: deps.owner,
        actorKind: "user",
        agentId: id,
        result: "success",
        detail: {
          count: unique.length,
          ...(agentIds !== undefined ? { agents: agentIds } : {}),
        },
      });
      return viewOf(record, await deps.agents.get(id));
    },

    async lookupAgent(agentId) {
      const described = await deps.directory.describe(agentId.trim());
      if (!described || described.environment) return { found: false };
      return {
        found: true,
        agentId: agentId.trim(),
        name: described.name,
        ownerName: described.ownerName,
      };
    },

    async extend(id, expiresAt) {
      // UNIT_BOUNDARY_DESCRIPTION: the owner's change of the expiry, "never" included; a later change by the Owning Agent replaces it, as this one replaces the agent's.
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
