import type { SpendLimitState } from "api-server-api";

import {
  NEUTRAL_FILL,
  NEUTRAL_LIGHT_FILL,
} from "../../budgets/lib/pool-colors.js";

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

export const LIMIT_STATE_SHARE: Readonly<Record<SpendLimitState, string>> = {
  ok: NEUTRAL_LIGHT_FILL,
  warn: "bg-warning/45",
  reached: "bg-danger/45",
};

export const LIMIT_STATE_TRACK: Readonly<Record<SpendLimitState, string>> = {
  ok: "bg-foreground/10",
  warn: "bg-warning/15",
  reached: "bg-danger/15",
};

export const LIMIT_STATE_PERCENT: Readonly<Record<SpendLimitState, string>> = {
  ok: "text-muted-foreground",
  warn: "text-warning-fg",
  reached: "text-danger",
};
