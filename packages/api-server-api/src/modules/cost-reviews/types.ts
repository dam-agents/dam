/**
 * UNIT_BOUNDARY_DESCRIPTION: one Agent the platform offers its owner a cost
 * review for: it ran unattended on enough of the last seven days and spent
 * enough in paid dollars or in Bobcoins to be worth a look. The amounts are
 * that window's Metered Spend, in micro-units of each unit.
 */
export interface CostReviewOffer {
  agentId: string;
  paidUsdMicros: number;
  bobcoinMicros: number;
  unattendedDays: number;
}

export const COST_REVIEW_LATER_DAYS = 30;

export interface CostReviewStarted {
  agentId: string;
  startedAt: string;
}

export interface CostReviewsService {
  start(agentId: string): Promise<CostReviewStarted>;
  dismiss(agentIds: readonly string[]): Promise<void>;
}
