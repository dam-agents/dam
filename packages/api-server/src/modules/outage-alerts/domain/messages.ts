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

export function providerNameOf(templateId: string): string {
  const type = providerTypeForTemplateId(templateId);
  return type === null ? templateId : PROVIDERS[type].displayName;
}

export function utcLabel(at: Date): string {
  const hours = String(at.getUTCHours()).padStart(2, "0");
  const minutes = String(at.getUTCMinutes()).padStart(2, "0");
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${hours}:${minutes} UTC`;
}

export interface AlertNotice {
  slack: string;
  telegram: string;
}

interface TextStyle {
  time(at: Date): string;
  text(value: string): string;
}

const SLACK: TextStyle = {
  time: (at) =>
    `<!date^${Math.floor(at.getTime() / 1000)}^{date_short_pretty} at {time}|${utcLabel(at)}>`,
  text: (value) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;"),
};

const TELEGRAM: TextStyle = {
  time: utcLabel,
  text: (value) => value,
};

function noticeOf(write: (style: TextStyle) => string[]): AlertNotice {
  return {
    slack: write(SLACK).join("\n"),
    telegram: write(TELEGRAM).join("\n"),
  };
}

function affectedByLabel(reason: OutageAlertAffectedBy): string {
  return match(reason)
    .with("schedule", () => "scheduled run failed")
    .with("slack", () => "Slack channel")
    .with("telegram", () => "Telegram chat")
    .exhaustive();
}

function agentLines(
  agents: readonly AffectedAgent[],
  style: TextStyle,
): string[] {
  const lines = agents
    .slice(0, MAX_AGENT_LINES)
    .map(
      (agent) =>
        `• ${style.text(agent.name)} — ${agent.affectedBy.map(affectedByLabel).join(", ")}`,
    );
  const more = agents.length - lines.length;
  return more > 0 ? [...lines, `and ${more} more`] : lines;
}

export function outageMessage(
  alert: OutageAlert,
  providerName: string,
  homeUrl: string,
): AlertNotice {
  return noticeOf((style) => {
    const provider = style.text(providerName);
    return [
      `${provider} has had an outage since ${style.time(alert.since)}. Work that ran on its own failed for these agents of yours:`,
      ...agentLines(alert.agents, style),
      `Runs that failed do not run again. Wait, or switch an agent to another provider: ${homeUrl}`,
      ...(alert.statusPageUrl
        ? [`${provider} status: ${alert.statusPageUrl}`]
        : []),
    ];
  });
}

export function recoveryMessage(
  alert: OutageAlert,
  recoveredAt: Date,
  providerName: string,
  homeUrl: string,
): AlertNotice {
  return noticeOf((style) => [
    `${style.text(providerName)} works again. It had problems from ${style.time(alert.since)} to ${style.time(recoveredAt)}. Runs that failed in that time do not run again, so check the last runs of:`,
    ...agentLines(alert.agents, style),
    homeUrl,
  ]);
}
