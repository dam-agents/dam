import type { SpendUnit } from "api-server-api";
import { match } from "ts-pattern";

import { getBrand } from "../../../brand.js";
import type { SpendBucket } from "./day-buckets.js";
import { bareSpend, formatSpend } from "./format.js";
import { formatDay, formatRange } from "./range-label.js";
import type { PresetPeriod } from "./spend-period.js";
import type { DayRange } from "./utc-day.js";

export const AGENT_LIMIT_NAME = "Agent spend limit";

export const OWN_LIMIT_NAME = "Your spend limit (all agents)";

export const CEILING_NAME = "Your spend ceiling (set by your operator)";

export function measuredSpendHelp(): string {
  return `${getBrand().name} measures every model call in the agent's gateway, for every harness. Spend limits count one UTC day.`;
}

export function apiSpendHelp(): string {
  return `What your agents paid for model calls, in US dollars. ${getBrand().name} measures each call in the agent's gateway, at your real prices. Days are UTC days. Use that a plan covers, such as a Claude subscription, is not in this total. OpenAI and Bedrock calls count only when your operator sets a price.`;
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

export function rangeLine(range: DayRange): string {
  return `${formatRange(range)} · UTC days`;
}

export function measuringStarted(startDay: string): string {
  return `Measuring started on ${formatDay(startDay)}.`;
}

export function notMeasured(startDay: string): string {
  return `Not measured. ${measuringStarted(startDay)}`;
}

export function planUseLine(planMicros: number): string {
  return `+ ${bareSpend(planMicros, "usd_list")} covered by plans, at no extra cost`;
}

export const MOSTLY_PLAN_USE =
  "Most of your use was covered by your plan, at no extra cost.";

export function bobLine(bobcoinMicros: number): string {
  return `Bob: ${formatSpend(bobcoinMicros, "bobcoin")}`;
}

export const BOB_HELP =
  "Bob counts in its own unit, Bobcoins. A Bob call that ends without usage data counts as your most expensive Bob call of the day. So this figure can be higher than Bob's own count.";

export function paidWithPlanUse(
  paidMicros: number,
  planMicros: number,
): string {
  return `${bareSpend(paidMicros, "usd")} + ${bareSpend(planMicros, "usd_list")} covered`;
}

export const NO_SPEND_IN_PERIOD = "No API spend in this period.";

export const SPEND_LOAD_ERROR = "Spend could not be loaded.";

export function meteringNoticeTitle(startDay: string): string {
  return `From ${formatDay(startDay)}, ${getBrand().name} measures the cost of each model call itself, at your real prices.`;
}

export const METERING_NOTICE_DETAIL =
  "Before that, it only had estimates from the agents, so earlier days are not shown.";

export const DISMISS_NOTICE = "Dismiss this notice";

export const SHOW_PLAN_USE = "Show use covered by plans";

export const VIEW_DETAILS = "View details";

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

export const CALENDAR_FOOTER = "UTC days. Weeks start on Monday.";

export const DONE = "Done";

export const NOT_MEASURED_YET = "Not measured yet";

export const AT_MOST_DAYS = "Choose at most 366 days";

export const API_CALLS = "API calls";

export const TOKENS_IN_OUT = "Tokens in / out";

export function estimatedCallsNote(calls: number): string {
  return calls === 1
    ? "1 call is estimated and counted high, because its reply had no usage data."
    : `${calls.toLocaleString("en-US")} calls are estimated and counted high, because their replies had no usage data.`;
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

export const COVERED_BY_PLAN = "Covered by a plan";

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
  return `Each agent reported these figures about itself. They are estimates at list prices, and they include use that a plan covers. No spend limit uses them. This view closes on ${formatDay(closesOn)}.`;
}
