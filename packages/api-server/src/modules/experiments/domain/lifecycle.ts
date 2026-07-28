import type { ExperimentStatus } from "api-server-api";

// The Experiment lifecycle rules, pure and in one place. The repository
// enforces every flip as an atomic conditional write (`WHERE status = from`);
// this module is the single source of which flips exist at all.

const TRANSITIONS: Record<ExperimentStatus, readonly ExperimentStatus[]> = {
  draft: ["running"],
  running: ["completed", "failed", "stopped"],
  completed: [],
  failed: [],
  stopped: [],
};

export function canTransition(
  from: ExperimentStatus,
  to: ExperimentStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ExperimentStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export interface SweepView {
  status: ExperimentStatus;
  /** Bumped on every accepted trace event. */
  lastActivityAt: string | null;
  /** Stamped at run start; the liveness clock before any event arrives. */
  executedAt: string | null;
}

/** The inactivity rule that lets every executed Experiment reach a terminal
 *  state: a `running` run that has been silent longer than the window is
 *  reaped to `failed` (which also releases the driver's hibernation pin).
 *  A running row with no clock at all is unreachable by construction
 *  (run start stamps `executedAt`), but reads as reapable rather than
 *  wedged-forever if it ever occurs. */
export function sweepDecision(
  experiment: SweepView,
  now: Date,
  windowMs: number,
): "fail" | "keep" {
  if (experiment.status !== "running") return "keep";
  const basis = experiment.lastActivityAt ?? experiment.executedAt;
  if (basis === null) return "fail";
  return now.getTime() - new Date(basis).getTime() > windowMs ? "fail" : "keep";
}
