import type { ExperimentStatus } from "api-server-api";

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
  lastActivityAt: string | null;
  executedAt: string | null;
}

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
