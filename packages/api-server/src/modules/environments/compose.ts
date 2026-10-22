import type { Redis } from "ioredis";
import type { Hono } from "hono";
import { createRedisTtlStore } from "../../core/ttl-store.js";
import { domainOf, SESSION_TTL_MS } from "./domain/gate.js";
import {
  createEnvironmentGate,
  noEnvironmentGate,
  type EnvironmentGate,
} from "./gate/environment-gate.js";
import {
  createEnvironmentFrontDoor,
  type ShareSignIn,
} from "./gate/front-door.js";
import {
  createEnvironmentSignIn,
  type EnvironmentSignIn,
} from "./services/environment-signin.js";
import {
  createAccessListsRepository,
  type AccessListsRepository,
} from "./infrastructure/access-lists-repository.js";
import { podBaseUrl } from "../agents/infrastructure/k8s.js";
import type { Db } from "db";
import type { AgentsService } from "api-server-api";
import type { RuntimeMutator } from "../runtime-delivery/index.js";
import { workspaceCommandEvent } from "../runtime-delivery/index.js";
import {
  createEnvironmentsRepository,
  type EnvironmentsRepository,
} from "./infrastructure/environments-repository.js";
import {
  createEnvironmentsService,
  type EnvironmentsConfig,
  type EnvironmentsServiceImpl,
} from "./services/environments-service.js";

// UNIT_BOUNDARY_DESCRIPTION: an Agent the cluster holds, as the orphan sweep reads it: its id, owner and the owning Agent it names, if any.
export interface ListedAgent {
  id: string;
  owner: string;
  environmentOf?: string;
  createdAt: Date;
}

// UNIT_BOUNDARY_DESCRIPTION: how long an Environment Agent may exist without its row before the sweep deletes it: longer than a create takes between its two writes, so a create still running is never cut short.
const ORPHAN_GRACE_MS = 10 * 60_000;

export interface ComposeEnvironmentsDeps {
  db: Db;
  agentsFor: (owner: string) => AgentsService;
  runtimeMutator: RuntimeMutator;
  config: EnvironmentsConfig;
  listAgents: () => Promise<ListedAgent[]>;
}

export interface EnvironmentsComposition {
  environmentsFor: (owner: string) => EnvironmentsServiceImpl;
  cleanupSource: {
    name: string;
    listAgentIds: () => Promise<string[]>;
    cleanup: (agentId: string) => Promise<void>;
  };
  sweepExpired: () => Promise<void>;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export const ENVIRONMENT_START_ITEM = "start";

// UNIT_BOUNDARY_DESCRIPTION: the shell command that makes an Environment's `start` command its first Startup Item: an openrc user service of root in ~/.config/rc, on at boot and started now. The command runs under sh -c, quoted so the shell neither splits nor expands it here.
export function startItemCommand(command: string): string {
  const rc = "$HOME/.config/rc";
  const script = `${rc}/init.d/${ENVIRONMENT_START_ITEM}`;
  return [
    `mkdir -p ${rc}/init.d ${rc}/runlevels/default`,
    `printf '%s\\n' '#!/sbin/openrc-run' 'command=/bin/sh' ${shellQuote(`command_args="-c ${shellQuote(command).replaceAll('"', '\\"')}"`)} > ${script}`,
    `chmod 755 ${script}`,
    `ln -sfn ${script} ${rc}/runlevels/default/${ENVIRONMENT_START_ITEM}`,
    `rc-service --user ${ENVIRONMENT_START_ITEM} start`,
  ].join(" && ");
}

// UNIT_BOUNDARY_DESCRIPTION: an Environment's name by its Agent id, for an approval that came from it.
export function environmentNameLookup(
  db: Db,
): (agentId: string) => Promise<string | null> {
  const repo = createEnvironmentsRepository(db);
  return async (agentId) => (await repo.get(agentId))?.name ?? null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Wires the environments module once per install.
 * The service is built per owner; the cleanup source, run when any Agent is
 * deleted, deletes the Environments it owned and the row of an Environment
 * itself, so neither outlives its Agent; the sweep deletes every Environment
 * whose expiry passed, as its owner, and every Environment Agent left without
 * a row by a create that died between its two writes. An Environment's `start` command is
 * delivered as a one-shot workspace command that writes it as a Startup Item,
 * an openrc user service, which then runs at every boot.
 */
export function composeEnvironments(
  deps: ComposeEnvironmentsDeps,
): EnvironmentsComposition {
  return composeEnvironmentsOver(
    createEnvironmentsRepository(deps.db),
    deps,
    createAccessListsRepository(deps.db),
  );
}

export function composeEnvironmentsOver(
  repo: EnvironmentsRepository,
  deps: Omit<ComposeEnvironmentsDeps, "db">,
  accessLists: AccessListsRepository,
): EnvironmentsComposition {
  const environmentsFor = (owner: string) =>
    createEnvironmentsService({
      owner,
      repo,
      accessLists,
      agents: deps.agentsFor(owner),
      config: deps.config,
      startCommand: async (agentId, command) => {
        await deps.runtimeMutator.bump(agentId, [
          workspaceCommandEvent(
            "environment-start",
            agentId,
            startItemCommand(command),
            new Date(),
          ),
        ]);
        await deps.runtimeMutator.enqueueAfterCommit(agentId);
      },
    });

  return {
    environmentsFor,

    cleanupSource: {
      name: "environments",
      listAgentIds: async () => {
        const ids = new Set(await repo.listAgentIds());
        for (const id of await repo.listOwningAgentIds()) ids.add(id);
        return [...ids];
      },
      cleanup: async (agentId) => {
        for (const record of await repo.listByOwningAgent(agentId))
          await environmentsFor(record.owner).remove(record, record.owner);
        await repo.delete(agentId);
        await accessLists.delete(agentId);
      },
    },

    async sweepExpired() {
      const rows = new Set(await repo.listAgentIds());
      const now = Date.now();
      for (const agent of await deps.listAgents()) {
        if (!agent.environmentOf || rows.has(agent.id)) continue;
        if (now - agent.createdAt.getTime() < ORPHAN_GRACE_MS) continue;
        try {
          await deps.agentsFor(agent.owner).delete(agent.id);
          process.stderr.write(
            `[environments] deleted ${agent.id}, an Environment Agent with no record\n`,
          );
        } catch (err) {
          process.stderr.write(
            `[environments] could not delete orphan ${agent.id}: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }
      const expired = await repo.listExpired(new Date());
      let swept = 0;
      for (const record of expired) {
        try {
          await environmentsFor(record.owner).remove(record, record.owner);
          swept += 1;
        } catch (err) {
          process.stderr.write(
            `[environments] could not delete expired ${record.agentId}: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }
      if (swept > 0)
        process.stderr.write(
          `[environments] swept ${swept} expired Environment(s)\n`,
        );
    },
  };
}

const HANDOFF_TTL_MS = 60_000;

// UNIT_BOUNDARY_DESCRIPTION: the path of an Environment's front door on the share host.
export const FRONT_DOOR_PREFIX = "/e/";

export interface ComposeEnvironmentGateDeps {
  db: Db;
  redis: Redis;
  urlTemplate: string | null;
  shareBaseUrl: string;
  share: ShareSignIn;
  ensureReady: (agentId: string) => Promise<unknown>;
  stampActivity: (agentId: string) => Promise<void>;
  namespace: string;
  brandName: string;
}

export interface EnvironmentGateComposition {
  gate: EnvironmentGate;
  // UNIT_BOUNDARY_DESCRIPTION: the front door the share host mounts at `/e`, or nothing when the install serves no Environments.
  frontDoor: Hono | null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The front for Environment addresses and its door
 * on the share host, or a gate that passes every request on when the install
 * serves no Environments (no environments domain). Visitors sign in with the
 * share host's own session and identity provider client, and an address's
 * session lasts while that share session does; signing out of an address
 * ends both and the identity provider's session. The hand-off codes and the
 * addresses' sessions live in Redis, so any api-server replica serves any
 * step.
 */
export function composeEnvironmentGate(
  deps: ComposeEnvironmentGateDeps,
): EnvironmentGateComposition {
  const template = deps.urlTemplate;
  const domain = domainOf(template);
  if (template === null || domain === null)
    return { gate: noEnvironmentGate, frontDoor: null };
  const addressUrl = (address: string) =>
    template.replace("{host}", () => address);
  const shareBase = deps.shareBaseUrl.replace(/\/+$/, "");
  const repo = createEnvironmentsRepository(deps.db);
  const ownerList = (owningAgentId: string) =>
    createAccessListsRepository(deps.db).get(owningAgentId);
  const signIn: EnvironmentSignIn = createEnvironmentSignIn({
    handoffs: createRedisTtlStore(deps.redis, "env:handoff", HANDOFF_TTL_MS),
    sessions: createRedisTtlStore(deps.redis, "env:session", SESSION_TTL_MS),
    share: deps.share,
    addressUrl,
    now: () => Date.now(),
  });
  const gate = createEnvironmentGate({
    domain,
    scheme: template.startsWith("https:") ? "https" : "http",
    frontDoorUrl: (address, next, binding) => {
      const url = new URL(`${shareBase}${FRONT_DOOR_PREFIX}${address}`);
      url.searchParams.set("next", next);
      url.searchParams.set("b", binding);
      return url.href;
    },
    signOutUrl: (address) =>
      deps.share.logoutUrl(`${FRONT_DOOR_PREFIX}${address}`),
    repo,
    ownerList,
    signIn,
    ensureReady: deps.ensureReady,
    stampActivity: deps.stampActivity,
    upstream: (agentId) => {
      const [host, port] = podBaseUrl(agentId, deps.namespace).split(":");
      return { host: host!, port: Number(port) };
    },
    brandName: deps.brandName,
  });
  const frontDoor = createEnvironmentFrontDoor({
    domain,
    addressUrl,
    repo,
    ownerList,
    signIn,
    share: deps.share,
    brandName: deps.brandName,
  });
  return { gate, frontDoor };
}
