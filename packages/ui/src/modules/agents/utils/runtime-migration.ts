import { match } from "ts-pattern";

import type {
  AgentView,
  RuntimeMigrationPhase,
  RuntimeMigrationView,
} from "../../../types.js";

export interface VmRuntimeAnswer {
  answered: boolean;
  vm: boolean;
}

export type RuntimeBadge =
  | { kind: "new"; label: string; title: string }
  | { kind: "old"; label: string; title: string }
  | { kind: "migrating"; label: string; title: string }
  | { kind: "failed"; label: string; title: string };

// UNIT_BOUNDARY_DESCRIPTION: what each phase of a migration is called where the user sees it, short enough for a badge and a button.
export function migrationPhaseLabel(phase: RuntimeMigrationPhase): string {
  return match(phase)
    .with("requested", () => "Preparing")
    .with("stopping", () => "Stopping")
    .with("copying", () => "Copying")
    .with("booting", () => "Booting")
    .with("verified", () => "Finishing")
    .with("failed", () => "Migration failed")
    .with("aborting", () => "Undoing")
    .exhaustive(() => "Migrating");
}

// UNIT_BOUNDARY_DESCRIPTION: the sentence behind a phase, for its tooltip, when the controller gave no reason of its own.
function migrationPhaseDescription(migration: RuntimeMigrationView): string {
  return match(migration.phase)
    .with(
      "requested",
      () =>
        "Preparing the new sandbox runtime. The agent keeps running until it is ready.",
    )
    .with(
      "stopping",
      () => "Stopping the agent so its home directory can be copied",
    )
    .with("copying", () =>
      migration.attempts && migration.attempts > 1
        ? `Copying the home directory to the new sandbox runtime (attempt ${migration.attempts})`
        : "Copying the home directory to the new sandbox runtime",
    )
    .with("booting", () => "Starting the agent on the new sandbox runtime")
    .with("verified", () => "The agent started on the new sandbox runtime")
    .with("failed", () => "Moving to the new sandbox runtime failed")
    .with(
      "aborting",
      () => "Undoing the move; the agent returns to its previous runtime",
    )
    .exhaustive(() => "Moving to the new sandbox runtime");
}

export function migrationTitle(migration: RuntimeMigrationView): string {
  return migration.message ?? migrationPhaseDescription(migration);
}

// UNIT_BOUNDARY_DESCRIPTION: which runtime badge an agent row shows. A migration under way is badged with its phase, and a failed one distinctly, whatever the experiment says, since the user started it and has something to decide. Otherwise, with the vm-sandboxes experiment off the new runtime is the rare case and is the one badged; with it on the new runtime is the default, so the badge moves to the agents still on the old container runtime, which are the ones with something left to do. Nothing is badged until both answers behind the experiment have arrived, so a row does not flip from one badge to the other on load.
export function runtimeBadge(
  agent: Pick<AgentView, "vm" | "runtimeMigratable" | "runtimeMigration">,
  vmRuntime: VmRuntimeAnswer,
): RuntimeBadge | null {
  if (!vmRuntime.answered) return null;
  const migration = agent.runtimeMigration;
  if (migration)
    return migration.phase === "failed"
      ? {
          kind: "failed",
          label: "Migration failed",
          title: migrationTitle(migration),
        }
      : {
          kind: "migrating",
          label: `Migrating: ${migrationPhaseLabel(migration.phase).toLowerCase()}`,
          title: migrationTitle(migration),
        };
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
  | { kind: "offer" }
  | { kind: "requesting" }
  | {
      kind: "migrating";
      label: string;
      title: string;
      abortable: boolean;
    }
  | {
      kind: "failed";
      title: string;
      abortable: boolean;
      retryable: boolean;
    };

// UNIT_BOUNDARY_DESCRIPTION: what an agent row offers for the runtime migration. A migration under way shows its phase and, until the agent has started on the new runtime, the way back; a failed one shows its reason with Retry and Abort. The migration's own state is read regardless of the experiment, since a user who turned it off mid-way still has to be able to finish or undo the move.
export function migrateAction(
  agent: Pick<AgentView, "vm" | "runtimeMigratable" | "runtimeMigration">,
  vmRuntime: VmRuntimeAnswer,
  pending: boolean,
): MigrateAction | null {
  if (!vmRuntime.answered) return null;
  const migration = agent.runtimeMigration;
  if (migration) return inProgress(migration);
  if (!vmRuntime.vm || agent.vm || !agent.runtimeMigratable) return null;
  return pending ? { kind: "requesting" } : { kind: "offer" };
}

function inProgress(migration: RuntimeMigrationView): MigrateAction {
  if (migration.phase === "failed")
    return {
      kind: "failed",
      title: migrationTitle(migration),
      abortable: migration.abortable,
      retryable: migration.retryable,
    };
  return {
    kind: "migrating",
    label: `${migrationPhaseLabel(migration.phase)}…`,
    title: migrationTitle(migration),
    abortable: migration.abortable,
  };
}

// UNIT_BOUNDARY_DESCRIPTION: how many requests are in flight for each agent. A count rather than a set, so an abort and a retry of the same agent both have to settle before its buttons come back.
export type InFlightIds = ReadonlyMap<string, number>;

type InFlightUpdate = (next: (ids: InFlightIds) => InFlightIds) => void;

function counted(ids: InFlightIds, id: string, by: number): InFlightIds {
  const next = new Map(ids);
  const n = (next.get(id) ?? 0) + by;
  if (n > 0) next.set(id, n);
  else next.delete(id);
  return next;
}

// UNIT_BOUNDARY_DESCRIPTION: runs one request for one agent and keeps it counted as in flight until that request itself settles. A mutation's variables name only its latest call, so they cannot say which of several rows is still waiting. A failure is already toasted by the mutation, so it is swallowed here.
export async function whileInFlight(
  id: string,
  update: InFlightUpdate,
  run: () => Promise<unknown>,
): Promise<void> {
  update((ids) => counted(ids, id, 1));
  try {
    await run();
  } catch {
    return;
  } finally {
    update((ids) => counted(ids, id, -1));
  }
}
