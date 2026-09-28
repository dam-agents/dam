import type { AgentView, RuntimeMigrationView } from "../../../types.js";

export interface VmRuntimeAnswer {
  answered: boolean;
  vm: boolean;
}

export type RuntimeBadge =
  | { kind: "new"; label: string; title: string }
  | { kind: "old"; label: string; title: string };

// UNIT_BOUNDARY_DESCRIPTION: which runtime badge an agent row shows. With the vm-sandboxes experiment off the new runtime is the rare case and is the one badged. With it on the new runtime is the default, so the badge moves to the agents still on the old container runtime, which are the ones with something left to do. Nothing is badged until both answers behind the experiment have arrived, so a row does not flip from one badge to the other on load.
export function runtimeBadge(
  agent: Pick<AgentView, "vm" | "runtimeMigratable">,
  vmRuntime: VmRuntimeAnswer,
): RuntimeBadge | null {
  if (!vmRuntime.answered) return null;
  if (!vmRuntime.vm)
    return agent.vm
      ? {
          kind: "new",
          label: "New runtime",
          title: "Runs on the new sandbox runtime",
        }
      : null;
  if (agent.vm) return null;
  return {
    kind: "old",
    label: "Old runtime",
    title: agent.runtimeMigratable
      ? "Runs on the previous container runtime. It can be migrated to the new sandbox runtime."
      : "Runs on the previous container runtime.",
  };
}

export type MigrateAction =
  { kind: "offer" } | { kind: "migrating"; message?: string };

// UNIT_BOUNDARY_DESCRIPTION: whether an agent row offers the runtime migration. The api-server switches the agent's backend to vm in the same write that requests the migration, so a migrating agent already reads as a vm agent; the migration's own state, not the backend, is what keeps its button showing as in progress.
export function migrateAction(
  agent: Pick<AgentView, "vm" | "runtimeMigratable" | "runtimeMigration">,
  vmRuntime: VmRuntimeAnswer,
  pending: boolean,
): MigrateAction | null {
  if (!vmRuntime.answered || !vmRuntime.vm) return null;
  if (agent.runtimeMigration) return migrating(agent.runtimeMigration);
  if (agent.vm || !agent.runtimeMigratable) return null;
  return pending ? { kind: "migrating" } : { kind: "offer" };
}

function migrating(migration: RuntimeMigrationView): MigrateAction {
  return migration.message
    ? { kind: "migrating", message: migration.message }
    : { kind: "migrating" };
}
