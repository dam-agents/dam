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
}

export interface UpdateEnvironmentInput {
  expiresAt?: Date;
  access?: string[] | null;
}

export interface EnvironmentsDeps {
  owner: string;
  repo: EnvironmentsRepository;
  agents: AgentsService;
  config: EnvironmentsConfig;
  startCommand: (agentId: string, command: string) => Promise<void>;
  now?: () => Date;
}

export interface OwningAgentEnvironments {
  create(input: CreateEnvironmentInput): Promise<EnvironmentView>;
  list(): Promise<EnvironmentView[]>;
  update(name: string, input: UpdateEnvironmentInput): Promise<EnvironmentView>;
  delete(name: string): Promise<void>;
}

export interface EnvironmentsServiceImpl {
  forOwningAgent(owningAgentId: string): OwningAgentEnvironments;
  list(owningAgentId: string): Promise<EnvironmentView[]>;
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
 * UNIT_BOUNDARY_DESCRIPTION: Environments for one owner. An owning vm Agent
 * creates, lists, changes and deletes its own; the owner lists, extends and
 * deletes them from the app. An Environment is an Agent record that names its
 * owning Agent, on the vm backend and the default image, with no harness, no
 * connections and no default model provider, so nothing in it can act as the
 * owning Agent; a row beside it holds its host label, endpoints, access list
 * and expiry. A `start` command becomes its first Startup Item through the
 * runtime channel. Deleting one deletes its Agent through the agents service,
 * so the Agent's own cleanup runs too.
 */
export function createEnvironmentsService(
  deps: EnvironmentsDeps,
): EnvironmentsServiceImpl {
  const now = deps.now ?? (() => new Date());

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

  async function owningAgent(id: string): Promise<Agent> {
    const agent = await deps.agents.get(id);
    if (!agent) refuse("no such agent", "NOT_FOUND");
    if (agent.spec.environmentOf)
      refuse("an Environment cannot own Environments");
    if (agent.spec.backend?.type !== "vm")
      refuse(
        "only an agent on the vm backend can own Environments: they run on its owner's VM runner beside it",
      );
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
      const expiresAt = expiry(input.expiresAt);
      const agent = await deps.agents.create({
        name: environmentAgentName(owning.name, input.name),
        description: `Environment ${input.name} of ${owning.name}`,
        vm: true,
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
        if (input.access !== undefined) patch.access = input.access;
        await deps.repo.update(record.agentId, patch);
        return view(
          { ...record, ...patch },
          await deps.agents.get(record.agentId),
        );
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
