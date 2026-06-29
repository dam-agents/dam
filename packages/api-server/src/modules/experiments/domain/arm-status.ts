import type { ArmStatus } from "api-server-api";

/** The three terminal Arm states. An Experiment is `completed` once every arm
 *  has reached one of these, regardless of the mix — the platform reports the
 *  comparison, it never judges the whole Experiment failed (there is no
 *  experiment-level `failed`). */
export const TERMINAL_ARM_STATUSES: readonly ArmStatus[] = [
  "completed",
  "failed",
  "stopped",
];

export function isArmTerminal(status: ArmStatus): boolean {
  return TERMINAL_ARM_STATUSES.includes(status);
}

/** Whether every arm has reached a terminal state — the rollup that decides
 *  Experiment completion. An experiment with no arms is not complete (nothing
 *  ever ran). */
export function allArmsTerminal(statuses: ArmStatus[]): boolean {
  return statuses.length > 0 && statuses.every(isArmTerminal);
}
