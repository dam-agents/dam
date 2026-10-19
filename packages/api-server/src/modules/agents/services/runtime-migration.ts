import type {
  RuntimeMigrationWrite,
  RuntimeMigrationWriteResult,
} from "../infrastructure/agents-repository.js";
import type { InfraAgent } from "../infrastructure/agent-mappers.js";
import {
  RUNTIME_MIGRATION_KEY,
  RUNTIME_MIGRATION_RETRY_KEY,
  RUNTIME_MIGRATION_SNAPSHOT_KEY,
  RUNTIME_MIGRATION_TARGET_KEY,
} from "../infrastructure/labels.js";
import {
  parseRuntimeMigrationTarget,
  runtimeMigrationReadyToSwitch,
  runtimeMigrationRefusal,
  runtimeMigrationRefusalReasons,
  runtimeMigrationRequest,
  runtimeMigrationSwitchSpec,
  type RuntimeMigrationContext,
  type RuntimeMigrationRefusal,
} from "../domain/runtime-migration.js";
import { ok, err } from "../../../core/result.js";
import { securityLog } from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";

// UNIT_BOUNDARY_DESCRIPTION: tells an open page that the Agent it shows has changed, since a move is asked for from outside the app and nothing else would refresh the row.
function emitUpdated(agent: InfraAgent): void {
  emit({
    type: EventType.AgentUpdated,
    agentId: agent.id,
    ...(agent.owner ? { ownerSub: agent.owner } : {}),
  });
}

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

// UNIT_BOUNDARY_DESCRIPTION: reads the Agent live, decides from what it read, and writes against that version, so a decision is never made from an Agent the controller has moved on from.
async function decideAndWrite<E>(
  deps: WriteDeps,
  id: string,
  decide: (
    agent: InfraAgent,
  ) => Promise<{ error: E } | { write: RuntimeMigrationWrite }>,
): Promise<
  Outcome<E | { type: "AgentNotFound" } | { type: "ConcurrentUpdate" }>
> {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const agent = await deps.getAgent(id);
    if (!agent) return err({ type: "AgentNotFound" as const });
    const decision = await decide(agent);
    if ("error" in decision) return err(decision.error);
    const written = await deps.writeMigration(id, decision.write);
    if (written.ok) return ok(written.value);
    if (written.reason === "not-found")
      return err({ type: "AgentNotFound" as const });
  }
  return err({ type: "ConcurrentUpdate" as const });
}

// UNIT_BOUNDARY_DESCRIPTION: turns an operator's request into a decided one. No spec is written: the request records the target shape, and the controller builds the machine beside the container from it. A move the api-server refuses is withdrawn again, since a request nobody can carry out would leave the Agent waiting on a machine that is never made, and the reasons go to the log the operator reads.
export function executeRuntimeMigration(
  deps: WriteDeps & {
    migration: (agent: InfraAgent) => Promise<RuntimeMigrationContext>;
  },
) {
  return async (id: string): Promise<Outcome<RuntimeMigrationRefusal>> => {
    const result = await decideAndWrite<RuntimeMigrationRefusal>(
      deps,
      id,
      async (agent) => {
        const migration = await deps.migration(agent);
        // UNIT_BOUNDARY_DESCRIPTION: the request this decides is the operator's, so it is not a migration standing in its way; any other phase is.
        const standing =
          agent.runtimeMigration?.phase === "requested"
            ? undefined
            : agent.runtimeMigration;
        const refusal = runtimeMigrationRefusal(
          { ...agent, runtimeMigration: standing },
          migration,
        );
        if (refusal) return { error: refusal };
        const { target } = runtimeMigrationRequest(
          agent.spec,
          migration.defaultStorageSize,
          migration.defaultMounts,
        );
        const annotations: Record<string, string | null> = {
          [RUNTIME_MIGRATION_KEY]: "requested",
          [RUNTIME_MIGRATION_TARGET_KEY]: JSON.stringify(target),
          [RUNTIME_MIGRATION_SNAPSHOT_KEY]: null,
          [RUNTIME_MIGRATION_RETRY_KEY]: null,
        };
        return {
          write: { annotations, resourceVersion: agent.resourceVersion },
        };
      },
    );
    if (result.ok) emitUpdated(result.value);
    if (result.ok)
      securityLog("info", "agent.runtime-migrate", {
        category: "resource",
        actor: deps.owner ?? null,
        actorKind: "system",
        agentId: id,
        result: "success",
        detail: { fromBackend: "container", toBackend: "vm" },
      });
    else
      securityLog("warn", "agent.runtime-migrate", {
        category: "resource",
        actor: deps.owner ?? null,
        actorKind: "system",
        agentId: id,
        result: "failure",
        reason: runtimeMigrationRefusalReasons(result.error).join("; "),
      });
    return result;
  };
}

const REQUEST_KEYS_CLEARED: Record<string, null> = {
  [RUNTIME_MIGRATION_KEY]: null,
  [RUNTIME_MIGRATION_TARGET_KEY]: null,
  [RUNTIME_MIGRATION_SNAPSHOT_KEY]: null,
  [RUNTIME_MIGRATION_RETRY_KEY]: null,
};

export interface RuntimeMigrationSwitch {
  tick(): Promise<void>;
}

// UNIT_BOUNDARY_DESCRIPTION: the api-server's whole part in a migration an operator asked for. The trigger is one annotation on the Agent, `agent-platform.ai/runtime-migration: requested`, which only someone with the cluster can write; a request without a target shape is that request, and the api-server decides it here as it would any move, writing the target or withdrawing the request and logging the refusal. The second half switches the Backend of every Agent whose machine the controller reports booted from its copy: the api-server is the only spec writer, so that is the one place a migration becomes permanent. Each write is decided from a live read and written against it, and one that cannot be read or written is left for the next tick.
export function createRuntimeMigrationSwitch(deps: {
  listAgents: () => Promise<InfraAgent[]>;
  getAgent: (id: string) => Promise<InfraAgent | null>;
  writeMigration: (
    id: string,
    patch: RuntimeMigrationWrite,
  ) => Promise<RuntimeMigrationWriteResult>;
  migration: (agent: InfraAgent) => Promise<RuntimeMigrationContext>;
  log: (message: string) => void;
}): RuntimeMigrationSwitch {
  function operatorRequested(agent: InfraAgent): boolean {
    return (
      agent.runtimeMigration?.phase === "requested" &&
      !agent.runtimeMigrationTarget
    );
  }

  async function promote(agent: InfraAgent): Promise<void> {
    const started = await executeRuntimeMigration({
      owner: undefined,
      getAgent: deps.getAgent,
      writeMigration: deps.writeMigration,
      migration: deps.migration,
    })(agent.id);
    if (started.ok) return;
    const reasons = runtimeMigrationRefusalReasons(started.error);
    deps.log(
      `[runtime-migration] ${agent.id} was asked to move and is refused: ${reasons.join("; ")}`,
    );
    if (started.error.type === "AgentNotFound") return;
    const withdrawn = await deps.writeMigration(agent.id, {
      annotations: REQUEST_KEYS_CLEARED,
      resourceVersion: (await deps.getAgent(agent.id))?.resourceVersion,
    });
    if (withdrawn.ok) emitUpdated(agent);
    else
      deps.log(
        `[runtime-migration] ${agent.id} was refused and its request could not be withdrawn (${withdrawn.reason}); the next tick decides it again`,
      );
  }

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
    emitUpdated(agent);
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
        try {
          if (operatorRequested(agent)) await promote(agent);
          else if (runtimeMigrationReadyToSwitch(agent))
            await switchOne(agent.id);
        } catch (e) {
          deps.log(
            `[runtime-migration] ${agent.id} could not be moved on: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    },
  };
}
