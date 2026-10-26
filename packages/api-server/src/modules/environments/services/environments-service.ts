import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  ENVIRONMENT_EXPIRY_DEFAULT_DAYS,
  type Agent,
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
import type { AccessListsRepository } from "../infrastructure/access-lists-repository.js";

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
  access?: string[];
  nestedVirtualization?: boolean;
}

export interface UpdateEnvironmentInput {
  expiresAt?: Date;
  access?: string[] | null;
}

export interface EnvironmentsDeps {
  owner: string;
  repo: EnvironmentsRepository;
  accessLists: AccessListsRepository;
  agents: AgentsService;
  config: EnvironmentsConfig;
  startCommand: (agentId: string, command: string) => Promise<void>;
  now?: () => Date;
}

export interface OwningAgentEnvironments {
  create(input: CreateEnvironmentInput): Promise<EnvironmentView>;
  list(): Promise<EnvironmentView[]>;
  update(name: string, input: UpdateEnvironmentInput): Promise<EnvironmentView>;
  wake(name: string): Promise<void>;
  delete(name: string): Promise<void>;
}

export interface EnvironmentsServiceImpl {
  forOwningAgent(owningAgentId: string): OwningAgentEnvironments;
  list(owningAgentId: string): Promise<EnvironmentView[]>;
  accessList(owningAgentId: string): Promise<string[]>;
  setAccessList(owningAgentId: string, emails: string[]): Promise<string[]>;
  extend(id: string, expiresAt: Date): Promise<EnvironmentView>;
  delete(id: string): Promise<void>;
  remove(record: EnvironmentRecord, actor: string): Promise<void>;
}

// UNIT_BOUNDARY_DESCRIPTION: an Agent asks for nesting itself through its spec, or the install asks for every agent, which shows as the NestedVirtualization condition the controller sets on each Agent that asks.
function asksToNest(agent: Agent): boolean {
  return (
    agent.spec.backend?.vm?.nestedVirtualization === true ||
    agent.nesting !== undefined
  );
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
 * owning Agent; a row beside it holds its host label, endpoints, access list
 * and expiry. A `start` command becomes its first Startup Item through the
 * runtime channel. The owning Agent wakes a sleeping one before it opens the
 * Environment Link, which reaches only a running machine. Deleting one deletes
 * its Agent through the agents service, so the Agent's own cleanup runs too.
 */
export function createEnvironmentsService(
  deps: EnvironmentsDeps,
): EnvironmentsServiceImpl {
  const now = deps.now ?? (() => new Date());

  function nesting(agent: Agent | null): EnvironmentView["nesting"] {
    if (!agent || !asksToNest(agent)) return null;
    if (agent.nesting?.enabled) return { enabled: true, reason: null };
    return {
      enabled: false,
      reason: agent.nesting?.message || "the machine has not been created yet",
    };
  }

  function view(
    record: EnvironmentRecord,
    agent: Agent | null,
  ): EnvironmentView {
    return {
      id: record.agentId,
      owningAgentId: record.owningAgentId,
      name: record.name,
      endpoints: record.endpoints.map((e) => ({
        ...e,
        url: endpointUrl(deps.config.urlTemplate, e.name, record.host),
      })),
      access: record.access,
      expiresAt: record.expiresAt.toISOString(),
      createdAt: record.createdAt.toISOString(),
      state: agent?.state ?? "unknown",
      nesting: nesting(agent),
    };
  }

  async function views(
    records: EnvironmentRecord[],
  ): Promise<EnvironmentView[]> {
    const agents = new Map((await deps.agents.list()).map((a) => [a.id, a]));
    return records
      .filter((r) => agents.has(r.agentId))
      .map((r) => view(r, agents.get(r.agentId) ?? null));
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

  // UNIT_BOUNDARY_DESCRIPTION: an owning agent may narrow who opens one of its Environments to people on its owner's list, and never add anyone; the refusal names the emails that are not on it, but never the list itself, which the agent cannot read.
  async function withinOwnerList(
    owningAgentId: string,
    emails: string[],
  ): Promise<void> {
    const allowed = new Set(await deps.accessLists.get(owningAgentId));
    const outside = emails.filter((e) => !allowed.has(e));
    if (outside.length > 0)
      refuse(
        `not on your owner's list of people: ${outside.join(", ")}. Only your owner adds people, in the app.`,
        "FORBIDDEN",
      );
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
    ): Promise<EnvironmentView> {
      const owning = await owningAgent(owningAgentId);
      if (await deps.repo.findByName(owningAgentId, input.name))
        refuse(`an Environment named ${input.name} already exists`, "CONFLICT");
      const held = await deps.repo.listByOwningAgent(owningAgentId);
      if (held.length >= deps.config.maxPerAgent)
        refuse(
          `this agent already holds ${held.length} Environments, the most it may; delete one first`,
          "PRECONDITION_FAILED",
        );
      if (input.nestedVirtualization && !asksToNest(owning))
        refuse(
          "this agent does not run VMs itself, so none of its Environments may: nested virtualization is given to an Environment only when its Owning Agent has it",
          "FORBIDDEN",
        );
      const expiresAt = expiry(input.expiresAt);
      if (input.access) await withinOwnerList(owningAgentId, input.access);
      const agent = await deps.agents.create({
        name: environmentAgentName(owning.name, input.name),
        description: `Environment ${input.name} of ${owning.name}`,
        environmentOf: owningAgentId,
        noDefaultProvider: true,
        egressPreset: "none",
        requireConnectionAddress: true,
        ...(input.storage ? { storage: input.storage } : {}),
        ...(input.nestedVirtualization ? { nestedVirtualization: true } : {}),
      });
      const record: EnvironmentRecord = {
        agentId: agent.id,
        owningAgentId,
        owner: deps.owner,
        name: input.name,
        host: environmentHost(input.name, randomBytes(3).toString("hex")),
        endpoints: input.endpoints,
        access: input.access ?? null,
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
      return view(record, agent);
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
        return views(await deps.repo.listByOwningAgent(owningAgentId));
      },

      async update(name, input) {
        if (input.expiresAt === undefined && input.access === undefined)
          refuse("nothing to change: give an expiry, an access list, or both");
        const record = await byName(name);
        const patch: Partial<EnvironmentRecord> = {};
        if (input.expiresAt) patch.expiresAt = expiry(input.expiresAt);
        if (input.access) await withinOwnerList(owningAgentId, input.access);
        if (input.access !== undefined) patch.access = input.access;
        await deps.repo.update(record.agentId, patch);
        return view(
          { ...record, ...patch },
          await deps.agents.get(record.agentId),
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

    async accessList(owningAgentId) {
      await ownedAgent(owningAgentId);
      return deps.accessLists.get(owningAgentId);
    },

    async setAccessList(owningAgentId, emails) {
      await ownedAgent(owningAgentId);
      const unique = [...new Set(emails)];
      await deps.accessLists.set(owningAgentId, deps.owner, unique);
      securityLog("info", "environment.access_list", {
        category: "authz-list",
        actor: deps.owner,
        actorKind: "user",
        agentId: owningAgentId,
        result: "success",
        detail: { count: unique.length },
      });
      return unique;
    },

    async extend(id, expiresAt) {
      const record = await ownRecord(id);
      const at = expiry(expiresAt);
      await deps.repo.update(id, { expiresAt: at });
      return view({ ...record, expiresAt: at }, await deps.agents.get(id));
    },

    async delete(id) {
      await remove(await ownRecord(id), deps.owner);
    },

    remove,
  };
}
