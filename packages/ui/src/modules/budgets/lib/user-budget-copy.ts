import type { UserBudgetDefaults } from "api-server-api";

import { parseCpuMilli } from "../../sandboxes/lib/quantity.js";
import { formatCores } from "./format.js";

export const USER_BUDGETS_TITLE = "Compute budgets";

export const USER_BUDGETS_HELP =
  "The CPU, memory and storage of the machine a user's agents share. An agent start that does not fit is refused. Each field a budget leaves empty uses the default.";

export const USER_BUDGETS_EMPTY = "No user has a compute budget of their own.";

export const USER_BUDGETS_LOAD_ERROR = "Couldn't load the compute budgets.";

export const SET_BUDGET = "Set a compute budget";

export const SET_BUDGET_HINT =
  "Give one user more or less room than the default, by their email.";

export const BUDGET_APPLIES_NEXT_START =
  "A change never stops an agent that runs now.";

export const BUDGET_SAVE_FAILED =
  "Couldn't save the compute budget. Try again.";

export const BUDGET_REMOVED_MEANWHILE =
  "Someone removed this budget, so there is nothing to change. The list now shows the current budgets.";

export const USER_BUDGETS_PAGE_SIZE = 25;

export function cpuText(quantity: string): string {
  const milli = parseCpuMilli(quantity);
  return milli === null ? quantity : `${formatCores(milli)} CPU`;
}

function defaultSizes(defaults: UserBudgetDefaults): string {
  const parts = [cpuText(defaults.cpu), `${defaults.memory} memory`];
  if (defaults.storage !== null) parts.push(`${defaults.storage} storage`);
  return parts.join(", ");
}

export function defaultsLine(defaults: UserBudgetDefaults): string {
  return `Users without their own budget: ${defaultSizes(defaults)}.`;
}

export function noMatchLine(query: string): string {
  return `No budget matches “${query}”.`;
}

export function pageLine(
  offset: number,
  shown: number,
  matched: number,
): string {
  if (shown === 0) return `0 of ${matched}`;
  return `${offset + 1}–${offset + shown} of ${matched}`;
}

export function removeConfirmLine(defaults: UserBudgetDefaults): string {
  return `then gets the default budget of ${defaultSizes(defaults)}.`;
}
