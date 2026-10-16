import type { SpendUnit } from "api-server-api";

import { getBrand } from "../../../brand.js";
import { bareSpend, formatSpend } from "./format.js";

export const AGENT_LIMIT_NAME = "Agent spend limit";

export const OWN_LIMIT_NAME = "Your spend limit (all agents)";

export const CEILING_NAME = "Your spend ceiling (set by your operator)";

export function measuredSpendHelp(): string {
  return `${getBrand().name} measures every model call in the agent's gateway, for every harness. Spend limits count one UTC day.`;
}

export function apiSpendHelp(): string {
  return `Paid API spend that ${getBrand().name} measured, in US dollars, per UTC day. The Claude subscription and Bob are not included.`;
}

export function connectionLimitName(connectionName: string): string {
  return `${connectionName} spend limit`;
}

export function continueLabel(amountMicros: number, unit: SpendUnit): string {
  return `Continue (+${unit === "bobcoin" ? formatSpend(amountMicros, unit) : bareSpend(amountMicros, unit)})`;
}
