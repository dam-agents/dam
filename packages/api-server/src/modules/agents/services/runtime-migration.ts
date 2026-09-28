import type {
  AbortRuntimeMigrationError,
  MigrateRuntimeError,
  RetryRuntimeMigrationError,
} from "api-server-api";
import type {
  RuntimeMigrationWrite,
  RuntimeMigrationWriteResult,
} from "../infrastructure/agents-repository.js";
import type { InfraAgent } from "../infrastructure/agent-mappers.js";
import {
  RUNTIME_MIGRATION_KEY,
  RUNTIME_MIGRATION_MOUNTS_KEY,
  RUNTIME_MIGRATION_RETRY_KEY,
  RUNTIME_MIGRATION_SNAPSHOT_KEY,
  RUNTIME_MIGRATION_TARGET_KEY,
} from "../infrastructure/labels.js";
import {
  abortRuntimeMigrationRefusal,
  parseRuntimeMigrationSnapshot,
  parseRuntimeMigrationTarget,
  retryRuntimeMigrationRefusal,
  runtimeMigrationReadyToSwitch,
  runtimeMigrationRefusal,
  runtimeMigrationRequest,
  runtimeMigrationRestoreSpec,
  runtimeMigrationSwitchSpec,
} from "../domain/runtime-migration.js";
import { ok, err } from "../../../core/result.js";
import { securityLog } from "../../../core/security-log.js";

export type { RuntimeMigrationWrite };

type Outcome<E> = { ok: true; value: InfraAgent } | { ok: false; error: E };

interface WriteDeps {
  owner: string | undefined;
  getAgent: (id: string) => Promise<InfraAgent | null>;
  writeMigration: (
    id: string,
    patch: RuntimeMigrationWrite,
  ) => Promise<RuntimeMigrationWriteResult>;
}

// UNIT_BOUNDARY_DESCRIPTION: how often a write that lost the race with the controller's status write is decided again from a fresh read. The controller writes status a handful of times per phase, so a second read almost always settles it.
const WRITE_ATTEMPTS = 3;

class RuntimeMigrationConflict extends Error {}

// UNIT_BOUNDARY_DESCRIPTION: reads the Agent live, decides from what it read, and writes against that version. When the controller wrote in between, the write conflicts and the decision is made again from a fresh read, so an abort never lands on a migration that has just been verified.
async function decideAndWrite<E>(
  deps: WriteDeps,
  id: string,
  decide: (
    agent: InfraAgent,
  ) => { error: E } | { write: RuntimeMigrationWrite },
): Promise<Outcome<E | { type: "AgentNotFound" }>> {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const agent = await deps.getAgent(id);
    if (!agent) return err({ type: "AgentNotFound" as const });
    const decision = decide(agent);
    if ("error" in decision) return err(decision.error);
    const written = await deps.writeMigration(id, decision.write);
    if (written.ok) return ok(written.value);
    if (written.reason === "not-found")
      return err({ type: "AgentNotFound" as const });
  }
  throw new RuntimeMigrationConflict(
    `agent ${id} kept changing while its runtime migration was being written`,
  );
}

// UNIT_BOUNDARY_DESCRIPTION: requests the move of one container Agent to the vm Backend. No spec is written: the request records the target shape, a snapshot of the fields the switch will change, and where each persisted path goes, and the controller builds the machine beside the container from them.
export function executeRuntimeMigration(
  deps: WriteDeps & {
    virtualizationEnabled: boolean;
    defaultStorageSize: string;
  },
) {
  return async (id: string): Promise<Outcome<MigrateRuntimeError>> => {
    const result = await decideAndWrite<MigrateRuntimeError>(
      deps,
      id,
      (agent) => {
        const refusal = runtimeMigrationRefusal(
          agent,
          deps.virtualizationEnabled,
        );
        if (refusal) return { error: refusal };
        const { target, snapshot, moves } = runtimeMigrationRequest(
          agent.spec,
          deps.defaultStorageSize,
        );
        const annotations: Record<string, string | null> = {
          [RUNTIME_MIGRATION_KEY]: "requested",
          [RUNTIME_MIGRATION_TARGET_KEY]: JSON.stringify(target),
          [RUNTIME_MIGRATION_SNAPSHOT_KEY]: JSON.stringify(snapshot),
          [RUNTIME_MIGRATION_RETRY_KEY]: null,
          [RUNTIME_MIGRATION_MOUNTS_KEY]:
            Object.keys(moves).length > 0 ? JSON.stringify(moves) : null,
        };
        return {
          write: { annotations, resourceVersion: agent.resourceVersion },
        };
      },
    );
    if (result.ok)
      securityLog("info", "agent.runtime-migrate", {
        category: "resource",
        actor: deps.owner ?? null,
        actorKind: "user",
        agentId: id,
        result: "success",
        detail: { fromBackend: "container", toBackend: "vm" },
      });
    return result;
  };
}

const REQUEST_KEYS_CLEARED: Record<string, null> = {
  [RUNTIME_MIGRATION_KEY]: null,
  [RUNTIME_MIGRATION_TARGET_KEY]: null,
  [RUNTIME_MIGRATION_SNAPSHOT_KEY]: null,
  [RUNTIME_MIGRATION_MOUNTS_KEY]: null,
  [RUNTIME_MIGRATION_RETRY_KEY]: null,
};

// UNIT_BOUNDARY_DESCRIPTION: takes the Agent back to the container before its machine has booted from the copy. The request is withdrawn and the snapshot's fields are written back; the controller then removes the machine, its seed and the copy Job, and the container resumes on its old volumes, which it never let go of.
export function executeAbortRuntimeMigration(deps: WriteDeps) {
  return async (id: string): Promise<Outcome<AbortRuntimeMigrationError>> => {
    const result = await decideAndWrite<AbortRuntimeMigrationError>(
      deps,
      id,
      (agent) => {
        const refusal = abortRuntimeMigrationRefusal(agent);
        if (refusal) return { error: refusal };
        const snapshot = parseRuntimeMigrationSnapshot(
          agent.runtimeMigrationSnapshot,
        );
        return {
          write: {
            ...(snapshot
              ? { spec: runtimeMigrationRestoreSpec(snapshot) }
              : {}),
            annotations: REQUEST_KEYS_CLEARED,
            resourceVersion: agent.resourceVersion,
          },
        };
      },
    );
    if (result.ok)
      securityLog("info", "agent.runtime-migrate.abort", {
        category: "resource",
        actor: deps.owner ?? null,
        actorKind: "user",
        agentId: id,
        result: "success",
      });
    return result;
  };
}

// UNIT_BOUNDARY_DESCRIPTION: asks the controller to start a failed migration over. The stamp is compared with the time the migration failed, so a retry asked before the failure it would answer is never taken as one.
export function executeRetryRuntimeMigration(
  deps: WriteDeps & { now?: () => Date },
) {
  return async (id: string): Promise<Outcome<RetryRuntimeMigrationError>> =>
    decideAndWrite<RetryRuntimeMigrationError>(deps, id, (agent) => {
      const refusal = retryRuntimeMigrationRefusal(agent);
      if (refusal) return { error: refusal };
      const at = (deps.now?.() ?? new Date()).toISOString();
      return {
        write: {
          annotations: {
            [RUNTIME_MIGRATION_RETRY_KEY]: `${at.slice(0, 19)}Z`,
          },
          resourceVersion: agent.resourceVersion,
        },
      };
    });
}

export interface RuntimeMigrationSwitch {
  tick(): Promise<void>;
}

// UNIT_BOUNDARY_DESCRIPTION: switches the Backend of every Agent whose machine the controller reports booted from its copy. The api-server is the only spec writer, so this is the one place a migration becomes permanent: the spec takes the target shape, and the request is withdrawn in the same write. Each switch is decided from a live read and written against it, and one that cannot be read or written is left for the next tick.
export function createRuntimeMigrationSwitch(deps: {
  listAgents: () => Promise<InfraAgent[]>;
  getAgent: (id: string) => Promise<InfraAgent | null>;
  writeMigration: (
    id: string,
    patch: RuntimeMigrationWrite,
  ) => Promise<RuntimeMigrationWriteResult>;
  log: (message: string) => void;
}): RuntimeMigrationSwitch {
  async function switchOne(id: string): Promise<void> {
    const agent = await deps.getAgent(id);
    if (!agent || !runtimeMigrationReadyToSwitch(agent)) return;
    const target = parseRuntimeMigrationTarget(agent.runtimeMigrationTarget);
    if (!target) {
      deps.log(
        `[runtime-migration] ${id} is verified but its target is not readable; not switching`,
      );
      return;
    }
    const written = await deps.writeMigration(id, {
      spec: runtimeMigrationSwitchSpec(target),
      annotations: REQUEST_KEYS_CLEARED,
      resourceVersion: agent.resourceVersion,
    });
    if (!written.ok) return;
    securityLog("info", "agent.runtime-migrate.switched", {
      category: "resource",
      actor: null,
      actorKind: "system",
      agentId: id,
      result: "success",
      detail: { fromBackend: "container", toBackend: "vm" },
    });
  }

  return {
    async tick() {
      const agents = await deps.listAgents();
      for (const agent of agents) {
        if (!runtimeMigrationReadyToSwitch(agent)) continue;
        try {
          await switchOne(agent.id);
        } catch (e) {
          deps.log(
            `[runtime-migration] switching ${agent.id} failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    },
  };
}
