/** Reserved-vs-Ceiling for the caller (#1900). Reserved sums the caller's
 *  up (non-hibernated, non-parked) agents' `spec.resources.limits` — each
 *  agent's size, i.e. what it can actually consume; limits hard-cap usage,
 *  so a user's agents can never burn past the Ceiling. Display-only: the
 *  controller enforces from the same specs, so the meter cannot disagree
 *  with enforcement structurally. */
export interface BudgetReserved {
  cpu: { reservedMilli: number; ceilingMilli: number };
  memory: { reservedBytes: number; ceilingBytes: number };
}

export interface BudgetsService {
  reserved(): Promise<BudgetReserved>;
}
