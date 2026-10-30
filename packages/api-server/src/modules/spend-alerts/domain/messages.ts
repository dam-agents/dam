import { agentPageUrl, formatSpendAmount } from "api-server-api";
import { match } from "ts-pattern";

import type { SpendStopLevel, SpendWorkStopped } from "../../../events.js";

export interface StopNotice {
  slack: string;
  telegram: string;
}

export interface StopNames {
  agent: string;
  connection: (connectionId: string) => string;
}

interface TextStyle {
  time(at: Date): string;
  text(value: string): string;
  bold(value: string): string;
  italic(value: string): string;
  link(url: string, label: string): string;
}

const SLACK: TextStyle = {
  time: (at) =>
    `<!date^${String(Math.floor(at.getTime() / 1000))}^{time} on {date_short}|00:00 UTC>`,
  text: (value) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;"),
  bold: (value) => `*${value}*`,
  italic: (value) => `_${value}_`,
  link: (url, label) => `<${url}|${label}>`,
};

const TELEGRAM: TextStyle = {
  time: () => "00:00 UTC",
  text: (value) => value,
  bold: (value) => value,
  italic: (value) => value,
  link: (url, label) => `${label}: ${url}`,
};

function levelName(
  level: SpendStopLevel,
  names: StopNames,
  style: TextStyle,
): string {
  return match(level)
    .with({ kind: "ceiling" }, () => "your spend ceiling")
    .with({ kind: "limit", scope: { kind: "agent" } }, () => "its spend limit")
    .with(
      { kind: "limit", scope: { kind: "connection" } },
      ({ scope }) =>
        `its ${style.text(names.connection(scope.connectionId))} spend limit`,
    )
    .with(
      { kind: "limit", scope: { kind: "owner-connection" } },
      ({ scope }) =>
        `your ${style.text(names.connection(scope.connectionId))} spend limit for all agents`,
    )
    .with(
      { kind: "limit", scope: { kind: "owner" } },
      () => "your spend limit for all agents",
    )
    .exhaustive();
}

function nearName(
  level: SpendStopLevel,
  names: StopNames,
  style: TextStyle,
): string {
  const name = levelName(level, names, style);
  return name.startsWith("its ")
    ? `${style.text(names.agent)}'s ${name.slice("its ".length)}`
    : name;
}

function amountOf(level: SpendStopLevel): string {
  return match(level)
    .with({ kind: "ceiling" }, ({ amountMicros }) =>
      formatSpendAmount(amountMicros, "usd"),
    )
    .with({ kind: "limit" }, ({ amountMicros, extensions, unit }) =>
      formatSpendAmount(amountMicros * (extensions + 1), unit),
    )
    .exhaustive();
}

function whatStops(
  level: SpendStopLevel,
  names: StopNames,
  style: TextStyle,
): string {
  return match(level)
    .with({ kind: "ceiling" }, () => "Paid model calls of all your agents stop")
    .with(
      { kind: "limit", scope: { kind: "agent" } },
      () => "Its paid model calls stop",
    )
    .with(
      { kind: "limit", scope: { kind: "connection" } },
      ({ scope }) =>
        `Its calls on ${style.text(names.connection(scope.connectionId))} stop`,
    )
    .with(
      { kind: "limit", scope: { kind: "owner-connection" } },
      ({ scope }) =>
        `Calls of all your agents on ${style.text(names.connection(scope.connectionId))} stop`,
    )
    .with(
      { kind: "limit", scope: { kind: "owner" } },
      () => "Paid model calls of all your agents stop",
    )
    .exhaustive();
}

export function countsAllAgents(level: SpendStopLevel): boolean {
  return (
    level.kind === "ceiling" ||
    level.scope.kind === "owner" ||
    level.scope.kind === "owner-connection"
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the page where the owner changes the level that
 * stopped the work: the agent's Usage section for its agent limit, its
 * Providers section for its Connection limit, Settings › Providers for a
 * Connection limit for all agents, and Settings › Usage for the own limit and
 * the ceiling, which only the operator changes but which shows there.
 */
export function limitPageUrl(
  level: SpendStopLevel,
  payer: string,
  uiBaseUrl: string,
): string {
  return match(level)
    .with({ kind: "limit", scope: { kind: "agent" } }, () =>
      agentPageUrl(uiBaseUrl, payer, "usage"),
    )
    .with({ kind: "limit", scope: { kind: "connection" } }, ({ scope }) =>
      agentPageUrl(uiBaseUrl, scope.agentId, "providers"),
    )
    .with(
      { kind: "limit", scope: { kind: "owner-connection" } },
      () => `${uiBaseUrl}/settings/providers`,
    )
    .otherwise(() => `${uiBaseUrl}/settings/usage`);
}

function nearLine(
  event: SpendWorkStopped,
  names: StopNames,
  style: TextStyle,
): string[] {
  if (event.near.length === 0) return [];
  const each = event.near.map(({ level, spentMicros, effectiveMicros }) => {
    const share =
      effectiveMicros > 0
        ? Math.floor((spentMicros * 100) / effectiveMicros)
        : 100;
    return `${nearName(level, names, style)} at ${String(share)}%`;
  });
  return [style.italic(`Also close: ${each.join("; ")}.`)];
}

function write(
  event: SpendWorkStopped,
  names: StopNames,
  reset: Date,
  uiBaseUrl: string,
  style: TextStyle,
): string {
  const level = event.level;
  const agent = style.text(names.agent);
  const who = countsAllAgents(level) ? "Your agents" : agent;
  const page = limitPageUrl(level, event.payer, uiBaseUrl);
  const link =
    level.kind === "ceiling"
      ? `Only the platform operator can raise it. ${style.link(page, "See your spend")}`
      : style.link(page, "Change the limit");
  return [
    style.bold(`${who} stopped: ${levelName(level, names, style)} is reached`),
    `${amountOf(level)} today. ${whatStops(level, names, style)} until ${style.time(reset)}.`,
    link,
    ...nearLine(event, names, style),
  ].join("\n");
}

export function stopMessage(
  event: SpendWorkStopped,
  names: StopNames,
  reset: Date,
  uiBaseUrl: string,
): StopNotice {
  return {
    slack: write(event, names, reset, uiBaseUrl, SLACK),
    telegram: write(event, names, reset, uiBaseUrl, TELEGRAM),
  };
}
