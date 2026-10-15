import type { SpendLimitState } from "api-server-api";

import { NEUTRAL_FILL } from "../../budgets/lib/pool-colors.js";

export const LIMIT_STATE_FILL: Readonly<Record<SpendLimitState, string>> = {
  ok: NEUTRAL_FILL,
  warn: "bg-warning",
  reached: "bg-danger",
};

export const LIMIT_STATE_TEXT: Readonly<Record<SpendLimitState, string>> = {
  ok: "text-foreground",
  warn: "text-warning-fg",
  reached: "text-danger",
};
