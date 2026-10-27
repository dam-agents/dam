import type { SpendAmount, SpendLimitState, SpendUnit } from "api-server-api";
import { match } from "ts-pattern";

import { formatDateTime } from "@/lib/format-time";

import { getBrand } from "../../../brand.js";
import { formatTokens } from "../../metrics/lib/format.js";
import { joinNames } from "./coverage.js";
import type { SpendBucket } from "./day-buckets.js";
import { bareSpend, formatSpend } from "./format.js";
import { formatDay, formatRange } from "./range-label.js";
import type { PresetPeriod } from "./spend-period.js";
import type { DayRange } from "./utc-day.js";

export const DELETED_AGENT_NAME = "Deleted agent";

export const AGENT_LIMIT_NAME = "Agent spend limit";

export const OWN_LIMIT_NAME = "Your spend limit (all agents)";

export const DAILY_LIMIT_TITLE = "Daily spend limit";

export const OWN_LIMIT_HELP =
  "Counts the paid API calls of all your agents. Subscriptions and Bob do not count: set their limits in Settings › Providers, or for one agent in its Providers section.";

export const PROVIDER_LIMITS_TITLE = "Provider limits for all agents";

export const PROVIDER_LIMITS_HELP =
  "Each one counts the calls of all your agents on one provider. Set them in Settings › Providers.";

export const EDIT_IN_PROVIDERS = "Edit in Providers";

export const AGENT_LIMIT_HELP =
  "Counts the paid API calls of this agent and its sub-agents.";

export const ALL_YOUR_AGENTS = "all your agents";

export const SPEND_STATUS_ERROR = "Couldn't load today's spend.";

export function limitButtonText(hasLimit: boolean): string {
  return hasLimit ? "Change" : "Set a limit";
}

export function limitButtonLabel(hasLimit: boolean, subject: string): string {
  return hasLimit
    ? `Change the daily spend limit for ${subject}`
    : `Set a limit on the daily spend of ${subject}`;
}

export function limitMeterLabel(subject: string, pct: number): string {
  return `Daily spend limit for ${subject}: ${String(Math.round(pct))}% used`;
}

const USED_TODAY: Readonly<Record<SpendUnit, (micros: number) => string>> = {
  usd: (micros) => `${bareSpend(micros, "usd")} spent today`,
  usd_list: (micros) =>
    `${bareSpend(micros, "usd_list")} covered by subscriptions today`,
  bobcoin: (micros) => `${formatSpend(micros, "bobcoin")} today`,
  free: (micros) => `${bareSpend(micros, "free")} spent today`,
};

export function usedToday(micros: number, unit: SpendUnit): string {
  return USED_TODAY[unit](micros);
}

export function spentWithoutLimit(micros: number, unit: SpendUnit): string {
  return `${usedToday(micros, unit)} · No limit`;
}

export function spentOfLimit(
  spentMicros: number,
  amountMicros: number,
  unit: SpendUnit,
): string {
  const limit =
    unit === "bobcoin"
      ? formatSpend(amountMicros, unit)
      : bareSpend(amountMicros, unit);
  return `${bareSpend(spentMicros, unit)} of ${limit}`;
}

export function spentOfLimitToday(
  spentMicros: number,
  amountMicros: number,
  unit: SpendUnit,
): string {
  return `${spentOfLimit(spentMicros, amountMicros, unit)} today`;
}

// UNIT_BOUNDARY_DESCRIPTION: a provider row's badge reads "spent / limit today", and a Bobcoin amount is written with the unit's short form rather than its name, since the badge has one line to spare.
export function badgeSpend(
  spentMicros: number,
  limitMicros: number | null,
  unit: SpendUnit,
): string {
  const amount = (micros: number) =>
    unit === "bobcoin"
      ? `${bareSpend(micros, unit)} Bc`
      : bareSpend(micros, unit);
  return limitMicros === null
    ? `${amount(spentMicros)} today`
    : `${amount(spentMicros)} / ${amount(limitMicros)} today`;
}

export function badgeSpendTip(unit: SpendUnit, hasLimit: boolean): string {
  return match(unit)
    .with(
      "usd_list",
      () =>
        "Covered by a subscription, so the amount is shown for comparison only. Click to set a limit anyway.",
    )
    .with("bobcoin", () =>
      hasLimit
        ? "Bobcoins spent today of the daily limit. Click to change it."
        : "Bobcoins spent today. Click to set a daily limit.",
    )
    .otherwise(() =>
      hasLimit
        ? "Spent today of the daily limit. Click to change it."
        : "Spent today. Click to set a daily limit.",
    );
}

export function percentOfLimit(
  spentMicros: number,
  effectiveMicros: number,
): number {
  if (effectiveMicros <= 0) return 100;
  return Math.min(100, Math.round((spentMicros / effectiveMicros) * 100));
}

export function limitStateText(
  state: SpendLimitState,
  resetTime: string,
): string | null {
  return match(state)
    .with("ok", () => null)
    .with("warn", () => "Close to the limit.")
    .with("reached", () => `Limit reached. ${paidCallsStop(resetTime)}`)
    .exhaustive();
}

export function paidCallsStop(resetTime: string): string {
  return `Paid calls stop until ${resetTime} your time.`;
}

export function continuedToday(extensions: number): string {
  return extensions === 1
    ? "You continued once today."
    : `You continued ${String(extensions)} times today.`;
}

export function resetsAtLine(resetTime: string): string {
  return `Resets at ${resetTime} your time.`;
}

export const CEILINGS_TITLE = "Spend ceilings";

export const CEILINGS_HELP =
  "The most a user's agents may spend on paid providers in one UTC day. At the ceiling, their model calls stop until the day resets, and nobody can continue them.";

export const CEILINGS_EMPTY = "No user has a spend ceiling of their own.";

export const CEILINGS_LOAD_ERROR = "Couldn't load the spend ceilings.";

export const SET_CEILING = "Set a spend ceiling";

export const SET_CEILING_HINT =
  "Give one user a daily maximum of their own, by their email.";

export function ceilingDefaultLine(defaultMicros: number | null): string {
  return defaultMicros === null
    ? "No default spend ceiling: users without their own have none."
    : `Users without their own spend ceiling: ${bareSpend(defaultMicros, "usd")} a day.`;
}

export function ceilingPerDay(amountMicros: number): string {
  return `${bareSpend(amountMicros, "usd")} a day`;
}

export const CEILING_APPLIES_NEXT_CALL =
  "It applies to the user's next model call.";

export const CEILING_SAVE_FAILED =
  "Couldn't save the spend ceiling. Try again.";

export const CEILING_REMOVED_MEANWHILE =
  "Someone removed this spend ceiling, so there is nothing to change. The list now shows the current ceilings.";

const ALSO_SPENT: Readonly<Record<SpendUnit, (micros: number) => string>> = {
  usd: (micros) => `${bareSpend(micros, "usd")} on paid API calls`,
  usd_list: (micros) =>
    `${bareSpend(micros, "usd_list")} covered by subscriptions`,
  bobcoin: (micros) => `${formatSpend(micros, "bobcoin")} on Bob`,
  free: (micros) => bareSpend(micros, "free"),
};

export function alsoSpent(amounts: readonly SpendAmount[]): string {
  return `Also ${joinNames(amounts.map((amount) => ALSO_SPENT[amount.unit](amount.costMicros)))}.`;
}

export function highEstimates(calls: number): string {
  return calls === 1
    ? "1 call is a high estimate."
    : `${calls.toLocaleString("en-US")} calls are high estimates.`;
}

export function apiSpendHelp(dayStart: string): string {
  return `What your agents and their sub-agents paid for model calls, in US dollars. ${getBrand().name} measures the cost of each call itself. ${dayStartSentence(dayStart)} Calls that a subscription covers, such as a Claude subscription, are not in this total. OpenAI and Bedrock calls count only when your operator sets a price.`;
}

function dayStartSentence(dayStart: string): string {
  return `Days start at ${dayStart} your time.`;
}

export const API_SPEND_TITLE = "API spend";

export const PERIOD_LABELS: Readonly<Record<PresetPeriod, string>> = {
  today: "Today",
  yesterday: "Yesterday",
  "this-week": "This week",
  "last-week": "Last week",
  "this-month": "This month",
  "last-month": "Last month",
};

export function rangeLine(range: DayRange, soFar: boolean): string {
  return soFar ? `${formatRange(range)}, so far` : formatRange(range);
}

export function measuringStarted(startDay: string): string {
  return `Measuring started on ${formatDay(startDay)}.`;
}

export function notMeasured(startDay: string): string {
  return `Not measured. ${measuringStarted(startDay)}`;
}

export function planUseLine(planMicros: number): string {
  return `Subscriptions also covered ${bareSpend(planMicros, "usd_list")}, at API prices.`;
}

export const MOSTLY_PLAN_USE =
  "Subscriptions covered more than you paid, at API prices.";

export function bobLine(bobcoinMicros: number): string {
  return `Bob: ${formatSpend(bobcoinMicros, "bobcoin")}, not in this total`;
}

export function bobHelp(): string {
  const brand = getBrand().name;
  return `Bobcoins are Bob's own unit, not dollars. ${brand} counts a Bob call without usage data like the agent's most expensive Bob call that day. So ${brand} can show more than Bob does.`;
}

export function paidWithPlanUse(
  paidMicros: number,
  planMicros: number,
): string {
  return `${bareSpend(paidMicros, "usd")} + ${bareSpend(planMicros, "usd_list")} covered`;
}

export const NO_SPEND_IN_PERIOD = "No API spend in this period.";

export const SPEND_LOAD_ERROR = "Spend could not be loaded.";

export function meteringNoticeTitle(startDay: string): string {
  return `From ${formatDay(startDay)}, ${getBrand().name} measures the cost of each model call itself.`;
}

export const METERING_NOTICE_DETAIL =
  "Before that, it only had estimates from the agents, so earlier days are not shown.";

export const DISMISS_NOTICE = "Dismiss this notice";

export function dismissNoticeHelp(earlierEstimatesOpen: boolean): string {
  return earlierEstimatesOpen
    ? "Hide this notice in this browser. The earlier estimates stay on Settings › Usage."
    : "Hide this notice in this browser.";
}

export const SHOW_PLAN_USE = "Show what subscriptions cover";

export const PLAN_USE_HELP =
  "Their value at API prices. It is not in the total, and you are not charged for it.";

export const USAGE_DETAILS = "Usage details";

export function connectionLimitName(connectionName: string): string {
  return `${connectionName} spend limit`;
}

export function allAgentsConnectionLimitName(connectionName: string): string {
  return `Your ${connectionName} spend limit (all agents)`;
}

export function continueLabel(amountMicros: number, unit: SpendUnit): string {
  return `Continue (+${unit === "bobcoin" ? formatSpend(amountMicros, unit) : bareSpend(amountMicros, unit)})`;
}

export const CHOOSE_DATES = "Choose dates";

export const PREVIOUS_PERIOD = "Previous period";

export const NEXT_PERIOD = "Next period";

export const PREVIOUS_MONTH = "Previous month";

export const NEXT_MONTH = "Next month";

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function weekLabel(week: number): string {
  return `W${week}`;
}

export function calendarFooter(dayStart: string): string {
  return `${dayStartSentence(dayStart)} Weeks start on Monday.`;
}

export const DONE = "Done";

export const NOT_MEASURED_YET = "Not measured yet";

export const AT_MOST_DAYS = "Choose at most 366 days";

export const API_CALLS = "API calls";

export const TOKENS_IN_OUT = "Tokens in / out";

export function estimatedCallsNote(calls: number): string {
  return calls === 1
    ? "1 call in these totals is a high estimate. Its real cost is likely lower."
    : `${calls.toLocaleString("en-US")} calls in these totals are high estimates. Their real cost is likely lower.`;
}

export const SPEND_BY_DAY = "Spend by day";

export const SPEND_BY_AGENT = "Spend by agent";

export const SPEND_BY_MODEL = "Spend by model";

export const SPEND_BY_PROVIDER = "Spend by provider";

function measuredBucketTitle(bucket: SpendBucket, showPlanUse: boolean) {
  const paid = bareSpend(bucket.paidMicros, "usd");
  return showPlanUse && bucket.planMicros > 0
    ? `${bucket.name}: ${paid} + ${bareSpend(bucket.planMicros, "usd_list")} covered`
    : `${bucket.name}: ${paid}`;
}

export function bucketTitle(bucket: SpendBucket, showPlanUse: boolean): string {
  return match(bucket.state)
    .with("not-measured", () => `${bucket.name}: not measured`)
    .with("future", () => bucket.name)
    .with("measured", () => measuredBucketTitle(bucket, showPlanUse))
    .exhaustive();
}

export const COVERED_VALUE_HELP =
  "A subscription covered these calls. This is their value at API prices. It is not in the total, and you are not charged for it.";

export const NO_COST = "No cost";

export const NOT_PRICED = "Not priced";

export function notPricedHelp(): string {
  return `${getBrand().name} has no price for this provider, so its calls count as $0. Your operator can set a price.`;
}

export const VIEW_EARLIER_ESTIMATES = "View the earlier estimates";

export const HIDE_EARLIER_ESTIMATES = "Hide the earlier estimates";

export const EARLIER_ESTIMATES_HEADING =
  "Earlier estimates, reported by the agents";

export function earlierEstimatesText(closesOn: string): string {
  return `Each agent reported these figures about itself. They are estimates at list prices, and they include calls that a subscription covers. No spend limit uses them. This view closes on ${formatDay(closesOn)}.`;
}

export const MODEL_TIME = "Sum of call times";

export const MODEL_TIME_HELP =
  "Each call counts from the request to the end of the reply. Calls at the same time each count. Cost depends on tokens, not on time.";

export const SPEND_BY_SESSION_TYPE = "Spend by session type";

export const SUB_AGENTS = "Sub-agents";

export const SUB_AGENTS_HELP =
  "Calls by sub-agents. They count toward the agent that started them.";

export const NO_SESSION = "No session";

export function noSessionHelp(): string {
  return `Calls of your agents that ${getBrand().name} cannot link to a session, such as a script started outside any session. They are in the total.`;
}

export function thisAgent(name: string): string {
  return `${name} (this agent)`;
}

export function moreSubAgents(count: number): string {
  return `${count} more`;
}

export function showAllSubAgents(count: number): string {
  return `Show all ${count} sub-agents`;
}

export function showMoreSubAgents(count: number): string {
  return `Show ${count} more`;
}

export const SHOW_LESS = "Show less";

export function subAgentOwnCalls(rootName: string): string {
  return `These are this sub-agent's own calls. They count for the limits of ${rootName}.`;
}

function units(micros: number, decimals: number): string {
  const value = micros / 1_000_000;
  const smallest = 10 ** -decimals;
  return value > 0 && value < smallest
    ? `<${smallest.toFixed(decimals)}`
    : value.toFixed(decimals);
}

export function paidCell(micros: number): string {
  const text = units(micros, 2);
  return text.startsWith("<") ? `<$${text.slice(1)}` : `$${text}`;
}

export function coveredCell(micros: number): string {
  return `${paidCell(micros)} covered`;
}

export function bobcoinCell(micros: number): string {
  return `${units(micros, 2)} Bobcoins`;
}

export function callsAndTokens(
  calls: number,
  tokensIn: number,
  tokensOut: number,
): string {
  const callText = calls === 1 ? "1 API call" : `${calls} API calls`;
  return `${callText} · ${formatTokens(tokensIn)} tokens in / ${formatTokens(tokensOut)} out`;
}

export function paidDetail(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)} paid`;
}

export function coveredDetail(micros: number): string {
  return `${paidCell(micros)} covered by your subscription, at API prices`;
}

export function callSpanLine(firstAt: string, lastAt: string): string {
  const at = (iso: string) =>
    formatDateTime(iso, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  return `Calls from ${at(firstAt)} to ${at(lastAt)}.`;
}

export function subAgentPart(amounts: string): string {
  return `Of this, ${amounts} came from sub-agents.`;
}

export const ESTIMATED_CALL_HELP =
  "Estimated: the provider reported no usage for this call.";

export const MEASURED_CALL_HELP = "The measured cost of this call.";

export function turnLineHelp(showsCost: boolean): string {
  const telemetry =
    "The agent reports the time, calls and tokens. The token count leaves out cached tokens.";
  return showsCost
    ? `${telemetry} ${getBrand().name} measures the cost, cached tokens included. The cost leaves out sub-agents.`
    : telemetry;
}

export function partThisAgent(amount: string): string {
  return `This agent: ${amount}`;
}

export function partSpent(amount: string): string {
  return `Spent: ${amount}`;
}

export function partOtherAgents(amount: string): string {
  return `Other agents: ${amount}`;
}

export function partLeft(amount: string): string {
  return `Left: ${amount}`;
}

export function spentTodayLine(spentMicros: number, unit: SpendUnit): string {
  return `${bareSpend(spentMicros, unit)} spent today.`;
}

export function alreadyReachedLine(
  spentMicros: number,
  unit: SpendUnit,
): string {
  return `This limit is already reached: ${bareSpend(spentMicros, unit)} spent today. Calls stop as soon as you save.`;
}

export function otherStopsFirstLine(
  otherName: string,
  leftMicros: number,
  unit: SpendUnit,
): string {
  return `${otherName} has ${bareSpend(leftMicros, unit)} left today, so it stops this agent first.`;
}

export function thisStopsFirstLine(
  leftMicros: number,
  unit: SpendUnit,
): string {
  return `This limit stops this agent first: ${bareSpend(leftMicros, unit)} left today.`;
}

export const ALSO_COUNTED_BY = "Also counted by";

export const LEVEL_GROUP_NAMES = {
  provider: "On one provider",
  every: "Every provider",
} as const;

export const STOPS_FIRST = "stops first";

export function setIn(place: string): string {
  return `Set in ${place}`;
}

export const LEVEL_NAMES = {
  agent: "Agent limit",
  total: "Total daily limit",
  ceiling: "Spend ceiling",
} as const;

export const LEVEL_SHORT = {
  agent: "The agent limit",
  total: "The total daily limit",
  ceiling: "The spend ceiling",
} as const;

export const LEVEL_SCOPES = {
  agent: "every paid provider",
  total: "all agents, every paid provider",
  ceiling: "set by your operator",
} as const;

export function allAgentsOn(connectionName: string): string {
  return `${connectionName}, all agents`;
}

export const THIS_AGENT = "this agent";

export function stopsFirstShort(name: string): string {
  return `${name} stops first`;
}

export const ALL_AGENTS_LIMIT_BUTTON_TIP =
  "Daily limit for all your agents on this provider";

export const AGENT_PROVIDER_LIMIT_BUTTON_TIP =
  "This agent's daily limit on this provider";

export function amountToday(text: string): string {
  return `${text} today`;
}
