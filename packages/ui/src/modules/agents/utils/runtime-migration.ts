import type {
  AgentView,
  RuntimeMigrationPlanView,
  RuntimeMigrationView,
} from "../../../types.js";

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
      : "Runs on the previous container runtime. It cannot be moved to the new sandbox runtime as it is set up now.",
  };
}

export type MigrateAction =
  | { kind: "offer" }
  | { kind: "refused" }
  | { kind: "migrating"; message?: string };

// UNIT_BOUNDARY_DESCRIPTION: whether an agent row offers the runtime migration. The api-server switches the agent's backend to vm in the same write that requests the migration, so a migrating agent already reads as a vm agent; the migration's own state, not the backend, is what keeps its button showing as in progress. A container agent the api-server would refuse still shows the action, disabled, so the user can find out why instead of wondering where the button went.
export function migrateAction(
  agent: Pick<AgentView, "vm" | "runtimeMigratable" | "runtimeMigration">,
  vmRuntime: VmRuntimeAnswer,
  pending: boolean,
): MigrateAction | null {
  if (!vmRuntime.answered || !vmRuntime.vm) return null;
  if (agent.runtimeMigration) return migrating(agent.runtimeMigration);
  if (agent.vm) return null;
  if (!agent.runtimeMigratable) return { kind: "refused" };
  return pending ? { kind: "migrating" } : { kind: "offer" };
}

function migrating(migration: RuntimeMigrationView): MigrateAction {
  return migration.message
    ? { kind: "migrating", message: migration.message }
    : { kind: "migrating" };
}

const AGENT_HOME = "/home/agent";
const WINDOW_UNITS: readonly { unit: string; ms: number }[] = [
  { unit: "day", ms: 24 * 3600_000 },
  { unit: "hour", ms: 3600_000 },
  { unit: "minute", ms: 60_000 },
  { unit: "second", ms: 1000 },
];

function windowText(ms: number): string {
  const exact = WINDOW_UNITS.find((u) => ms % u.ms === 0);
  const unit = exact ?? { unit: "second", ms: 1000 };
  const n = exact ? ms / unit.ms : Math.ceil(ms / unit.ms);
  return `${n} ${unit.unit}${n === 1 ? "" : "s"}`;
}

// UNIT_BOUNDARY_DESCRIPTION: what the confirm dialog says about the old volumes. The window is an install setting the plan passes through: null means the api-server could not read it, which is said as such rather than guessed; zero means the volumes are not kept at all; any other window is said in the largest unit it is a whole number of, so a week reads as 7 days and half an hour as 30 minutes.
export function retentionSentence(ms: number | null): string {
  if (ms === null)
    return "The old volumes are kept for a while after the move, so an admin can recover anything missing.";
  if (ms <= 0)
    return "The old volumes are not kept: they are deleted once the move has finished.";
  return `The old volumes are kept for ${windowText(ms)} after the move, so an admin can recover anything missing.`;
}

export interface PlanMoveLine {
  from: string;
  to: string;
  stays: boolean;
}

// UNIT_BOUNDARY_DESCRIPTION: the persisted paths the confirm dialog lists. A path already under the home keeps its place and is said to stay; a path outside it is said to live at its new place, with the home written as ~ the way the agent's own shell shows it. How the old path keeps working is the platform's business, so the dialog names only where the data will live.
export function planMoveLines(
  plan: Pick<RuntimeMigrationPlanView, "moves">,
): PlanMoveLine[] {
  const tilde = (path: string) =>
    path === AGENT_HOME
      ? "~"
      : path.startsWith(`${AGENT_HOME}/`)
        ? `~${path.slice(AGENT_HOME.length)}`
        : path;
  return plan.moves.map((m) => ({
    from: m.from,
    to: tilde(m.to),
    stays: m.from === m.to,
  }));
}
