import { PROVIDERS, providerTypeForTemplateId } from "api-server-api";
import { match } from "ts-pattern";

import type {
  AffectedAgent,
  OutageAlert,
  OutageAlertAffectedBy,
} from "./alert-rules.js";

const MAX_AGENT_LINES = 10;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function providerNameOf(templateId: string, brandName: string): string {
  const type = providerTypeForTemplateId(templateId);
  if (type === null) return templateId;
  return type === "platform" ? brandName : PROVIDERS[type].displayName;
}

export function utcLabel(at: Date): string {
  const hours = String(at.getUTCHours()).padStart(2, "0");
  const minutes = String(at.getUTCMinutes()).padStart(2, "0");
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${hours}:${minutes} UTC`;
}

function slackTime(at: Date): string {
  const seconds = Math.floor(at.getTime() / 1000);
  return `<!date^${seconds}^{date_short_pretty} at {time}|${utcLabel(at)}>`;
}

function slackEscape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function affectedByLabel(reason: OutageAlertAffectedBy): string {
  return match(reason)
    .with("failed-calls", () => "calls failed")
    .with("schedule", () => "schedule")
    .with("slack", () => "Slack channel")
    .with("telegram", () => "Telegram chat")
    .exhaustive();
}

function agentLines(agents: readonly AffectedAgent[]): string[] {
  const lines = agents
    .slice(0, MAX_AGENT_LINES)
    .map(
      (agent) =>
        `• ${slackEscape(agent.name)} — ${agent.affectedBy.map(affectedByLabel).join(", ")}`,
    );
  const more = agents.length - lines.length;
  return more > 0 ? [...lines, `and ${more} more`] : lines;
}

export function outageMessage(
  alert: OutageAlert,
  providerName: string,
  homeUrl: string,
): string {
  return [
    `${providerName} has had problems since ${slackTime(alert.since)}. These agents of yours use it, and they can fail until it works again:`,
    ...agentLines(alert.agents),
    `Wait, or switch an agent to another provider: ${homeUrl}`,
    ...(alert.statusPageUrl
      ? [`${providerName} status: ${alert.statusPageUrl}`]
      : []),
  ].join("\n");
}

export function recoveryMessage(
  alert: OutageAlert,
  recoveredAt: Date,
  providerName: string,
  homeUrl: string,
): string {
  return [
    `${providerName} works again. It had problems from ${slackTime(alert.since)} to ${slackTime(recoveredAt)}. Runs that failed in that time do not run again, so check the last runs of:`,
    ...agentLines(alert.agents),
    homeUrl,
  ].join("\n");
}
