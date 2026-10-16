import type { SpendBreakdown } from "api-server-api";

import {
  Stat,
  TokensInOut,
} from "../../metrics/components/spend-stat-cards.js";
import { API_CALLS, TOKENS_IN_OUT } from "../lib/copy.js";

export function MeasuredStatCards({
  totals,
}: {
  totals: SpendBreakdown["totals"];
}) {
  const sum = (count: (row: SpendBreakdown["totals"][number]) => number) =>
    totals.reduce((total, row) => total + count(row), 0);
  const tokensIn = sum(
    (row) =>
      row.uncachedInputTokens +
      row.cacheReadTokens +
      row.cacheWrite5mTokens +
      row.cacheWrite1hTokens,
  );
  return (
    <dl className="grid grid-cols-2 gap-3">
      <Stat label={API_CALLS}>
        {sum((row) => row.calls).toLocaleString("en-US")}
      </Stat>
      <Stat label={TOKENS_IN_OUT}>
        <TokensInOut
          tokensIn={tokensIn}
          tokensOut={sum((row) => row.outputTokens)}
        />
      </Stat>
    </dl>
  );
}
