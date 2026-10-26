import { match } from "ts-pattern";

import type {
  AgentView,
  RuntimeMigrationPhase,
  RuntimeMigrationView,
} from "../../../types.js";

export type RuntimeBadge =
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
    .with(
      "failed",
      () =>
        "Moving to the new sandbox runtime failed; an operator finishes or undoes the move",
    )
    .with(
      "aborting",
      () => "Undoing the move; the agent returns to its previous runtime",
    )
    .exhaustive(() => "Moving to the new sandbox runtime");
}

export function migrationTitle(migration: RuntimeMigrationView): string {
  return migration.message ?? migrationPhaseDescription(migration);
}

// UNIT_BOUNDARY_DESCRIPTION: which runtime badge an agent row shows: a migration under way is badged with its phase, and a failed one distinctly, so a stuck move is never mistaken for one still running. Nothing else is badged, since the runtime an agent runs on is not a choice the web app offers.
export function runtimeBadge(
  agent: Pick<AgentView, "runtimeMigration">,
): RuntimeBadge | null {
  const migration = agent.runtimeMigration;
  if (!migration) return null;
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
}
