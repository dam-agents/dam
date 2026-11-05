import { COST_REVIEW_LATER_DAYS, type CostReviewOffer } from "api-server-api";

export const OFFER_WINDOW_DAYS = 7;
export const MIN_AGENT_AGE_DAYS = 7;
export const MIN_UNATTENDED_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CostReviewFloors {
  paidUsdMicros: number;
  bobcoinMicros: number;
}

export interface OfferCandidate {
  agentId: string;
  createdAt: Date;
  supportsReview: boolean;
  paidUsdMicros: number;
  bobcoinMicros: number;
  unattendedDays: number;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: which of an owner's Agents get the platform's
 * offer of a cost review: an Agent whose image can run it, at least a week
 * old, that ran unattended on enough of the window's days and spent enough in
 * paid dollars or in Bobcoins. Dollars and Bobcoins are never added up, so
 * each has its own floor.
 * The Agents that spent the most paid dollars come first.
 */
export function costReviewOffersOf(
  candidates: readonly OfferCandidate[],
  floors: CostReviewFloors,
  now: Date,
): CostReviewOffer[] {
  const bornBefore = now.getTime() - MIN_AGENT_AGE_DAYS * DAY_MS;
  return candidates
    .filter(
      (c) =>
        c.supportsReview &&
        c.createdAt.getTime() <= bornBefore &&
        c.unattendedDays >= MIN_UNATTENDED_DAYS &&
        (c.paidUsdMicros >= floors.paidUsdMicros ||
          c.bobcoinMicros >= floors.bobcoinMicros),
    )
    .sort(
      (a, b) =>
        b.paidUsdMicros - a.paidUsdMicros || b.bobcoinMicros - a.bobcoinMicros,
    )
    .map((c) => ({
      agentId: c.agentId,
      paidUsdMicros: c.paidUsdMicros,
      bobcoinMicros: c.bobcoinMicros,
      unattendedDays: c.unattendedDays,
    }));
}

export function offerWindowStart(now: Date): string {
  return new Date(now.getTime() - (OFFER_WINDOW_DAYS - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function laterSince(now: Date): Date {
  return new Date(now.getTime() - COST_REVIEW_LATER_DAYS * DAY_MS);
}
