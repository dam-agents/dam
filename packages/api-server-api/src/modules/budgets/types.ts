/** Reserved (summed running-agent requests, not live use) vs ceiling (#1900). */
export interface BudgetUsage {
  cpu: { reservedMilli: number; limitMilli: number };
  memory: { reservedBytes: number; limitBytes: number };
}

export interface BudgetsService {
  usage(): Promise<BudgetUsage>;
}
