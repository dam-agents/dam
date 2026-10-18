import type { SpendAmount, SpendLimitState, SpendUnit } from "api-server-api";
import { match } from "ts-pattern";

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

export const CEILING_NAME = "Your spend ceiling (set by your operator)";

export const DAILY_LIMIT_TITLE = "Daily spend limit";

export const OWN_LIMIT_HELP =
  "Counts the paid API calls of all your agents. Subscriptions and Bob do not count: set those limits in each agent's Providers section.";

export const CONNECTION_LIMIT_TITLE = "Daily limit";

export function connectionLimitHelp(unitExplanation: string | null): string {
  return unitExplanation
    ? `${unitExplanation} Only this limit stops calls on this provider. The agent's limit and your limit for all agents do not count them.`
    : "Counts this agent's paid API calls on this provider.";
}

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
  leftMicros: number | null,
  unit: SpendUnit,
): string {
  const limit =
    unit === "bobcoin"
      ? formatSpend(amountMicros, unit)
      : bareSpend(amountMicros, unit);
  const of = `${bareSpend(spentMicros, unit)} of ${limit} today`;
  return leftMicros === null
    ? of
    : `${of} · ${bareSpend(leftMicros, unit)} left`;
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

export function ceilingLine(spentMicros: number, amountMicros: number): string {
  return `Spend ceiling: ${bareSpend(spentMicros, "usd")} of ${bareSpend(amountMicros, "usd")} today`;
}

export const CEILING_HELP =
  "Your operator sets this ceiling for you. You cannot change it.";

export function nearerLimitLine(
  kind: "owner" | "ceiling",
  leftMicros: number,
): string {
  const left = bareSpend(leftMicros, "usd");
  return kind === "owner"
    ? `Your limit for all agents has ${left} left today, so it stops this agent first.`
    : `Your spend ceiling has ${left} left today, so it stops this agent first.`;
}

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
  return `Calls of your agents that ${getBrand().name} cannot link to a session, such as Bedrock calls. They are in the total.`;
}

export function thisAgent(name: string): string {
  return `${name} (this agent)`;
}

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

export function subAgentPart(amounts: string): string {
  return `Of this, ${amounts} came from sub-agents.`;
}

export function turnLineHelp(showsCost: boolean): string {
  const telemetry =
    "The agent reports the time, calls and tokens. The token count leaves out cached tokens.";
  return showsCost
    ? `${telemetry} ${getBrand().name} measures the cost, cached tokens included. The cost leaves out sub-agents.`
    : telemetry;
}
