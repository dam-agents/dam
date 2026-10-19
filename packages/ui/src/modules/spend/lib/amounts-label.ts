import type { SpendAmount, SpendSessionRow } from "api-server-api";

import {
  bobcoinCell,
  callsAndTokens,
  coveredCell,
  coveredDetail,
  paidCell,
  paidDetail,
  subAgentPart,
} from "./copy.js";
import { unitTotals } from "./measured-spend.js";

export function amountsLabel(amounts: readonly SpendAmount[]): string | null {
  const totals = unitTotals(amounts);
  if (totals.usd > 0) return paidCell(totals.usd);
  if (totals.usd_list > 0) return coveredCell(totals.usd_list);
  if (totals.bobcoin > 0) return bobcoinCell(totals.bobcoin);
  return null;
}

function amountsList(amounts: readonly SpendAmount[]): string {
  const totals = unitTotals(amounts);
  return [
    totals.usd > 0 ? paidCell(totals.usd) : null,
    totals.usd_list > 0 ? coveredCell(totals.usd_list) : null,
    totals.bobcoin > 0 ? bobcoinCell(totals.bobcoin) : null,
  ]
    .filter((part) => part !== null)
    .join(" + ");
}

export function sessionSpendTitle(row: SpendSessionRow): string {
  const totals = unitTotals(row.amounts);
  const tokensIn =
    row.uncachedInputTokens +
    row.cacheReadTokens +
    row.cacheWrite5mTokens +
    row.cacheWrite1hTokens;
  const lines = [
    [
      callsAndTokens(row.calls, tokensIn, row.outputTokens),
      totals.usd > 0 ? paidDetail(totals.usd) : null,
      totals.usd_list > 0 ? coveredDetail(totals.usd_list) : null,
      totals.bobcoin > 0 ? bobcoinCell(totals.bobcoin) : null,
    ]
      .filter((part) => part !== null)
      .join(" · "),
  ];
  const subAgents = amountsList(row.subAgentAmounts);
  if (subAgents) lines.push(subAgentPart(subAgents));
  return lines.join("\n");
}
