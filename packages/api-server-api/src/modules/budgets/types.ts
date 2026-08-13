export interface BudgetReserved {
  cpu: { reservedMilli: number; ceilingMilli: number };
  memory: { reservedBytes: number; ceilingBytes: number };
}

export interface BudgetsService {
  reserved(): Promise<BudgetReserved>;
}
