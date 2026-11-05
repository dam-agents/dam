import {
  COST_REVIEW_LATER_DAYS,
  type CostReviewOffer,
  MICROS_PER_UNIT,
} from "api-server-api";

import { formatSpent } from "../../spend/lib/format.js";

export const DISMISSED_HINT = `The offer comes back in ${String(COST_REVIEW_LATER_DAYS)} days if the agent still qualifies. You can ask an agent for a cost review in its chat at any time.`;

export const STILL_OPENING_HINT =
  "The cost review started but is taking a while to open. You will find it in the agent's chat.";

export const OFFER_FOOTER = `Later asks again in ${String(COST_REVIEW_LATER_DAYS)} days. You can ask an agent for a review in its chat any time.`;

export function costReviewHeadline(
  offers: readonly CostReviewOffer[],
  nameOf: (agentId: string) => string,
): string {
  const [only] = offers;
  return offers.length === 1 && only
    ? `${nameOf(only.agentId)} could cost less`
    : `${String(offers.length)} agents could cost less`;
}

function roundBobcoins(micros: number): string {
  const amount = (micros / MICROS_PER_UNIT).toLocaleString("en-US", {
    maximumFractionDigits: 1,
  });
  return `${amount} Bobcoins`;
}

export function offerSpendLine(offer: CostReviewOffer): string {
  const spent = [
    offer.paidUsdMicros > 0 && formatSpent(offer.paidUsdMicros, "usd"),
    offer.bobcoinMicros > 0 && roundBobcoins(offer.bobcoinMicros),
  ].filter((part): part is string => typeof part === "string");
  return spent.join(" and ");
}
