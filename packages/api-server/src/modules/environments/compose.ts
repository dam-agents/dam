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

export interface ComposeEnvironmentsDeps {
  db: Db;
  agentsFor: (owner: string) => AgentsService;
  runtimeMutator: RuntimeMutator;
  config: EnvironmentsConfig;
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
    `XDG_RUNTIME_DIR=/run/user/0 rc-service --user ${ENVIRONMENT_START_ITEM} start`,
  ].join(" && ");
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Wires the environments module once per install.
 * The service is built per owner; the cleanup source, run when any Agent is
 * deleted, deletes the Environments it owned and the row of an Environment
 * itself, so neither outlives its Agent; the sweep deletes every Environment
 * whose expiry passed, as its owner. An Environment's `start` command is
 * delivered as a one-shot workspace command that writes it as a Startup Item,
 * an openrc user service, which then runs at every boot.
 */
export function composeEnvironments(
  deps: ComposeEnvironmentsDeps,
): EnvironmentsComposition {
  return composeEnvironmentsOver(createEnvironmentsRepository(deps.db), deps);
}

export function composeEnvironmentsOver(
  repo: EnvironmentsRepository,
  deps: Omit<ComposeEnvironmentsDeps, "db">,
): EnvironmentsComposition {
  const environmentsFor = (owner: string) =>
    createEnvironmentsService({
      owner,
      repo,
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
      },
    },

    async sweepExpired() {
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
