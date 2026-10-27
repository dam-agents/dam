import {
  PROVIDERS,
  providerTypeForTemplateId,
  type ProviderStatusView,
  type SessionPair,
} from "api-server-api";
import { match } from "ts-pattern";

import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import type { ChannelPair, ChannelRef } from "./channel-profile.js";
import { escapeFrameText } from "./frame-text.js";

export interface ProviderOutageLookup {
  templateId: string | null;
  status: ProviderStatusView;
}

export type ChannelProviderOutage = (
  agentId: string,
  channel: ChannelRef,
) => Promise<ProviderOutageLookup | null>;

/* UNIT_BOUNDARY_DESCRIPTION: the outage a channel's failed turn names is the one on the template that turn runs on: the channel's own pick, else the agent's channel default, which a channel bound before profiles keeps. */
export function createChannelProviderOutage(deps: {
  channelPair: ChannelPair;
  defaultPair: (agentId: string) => Promise<SessionPair | null | undefined>;
  templateOf: (agentId: string, connectionId: string) => Promise<string | null>;
  status: () => Promise<ProviderStatusView>;
}): ChannelProviderOutage {
  const templateOf = async (agentId: string, channel: ChannelRef) => {
    const pair =
      (await deps.channelPair(agentId, channel).catch(() => null)) ??
      (await deps.defaultPair(agentId));
    return pair?.provider ? deps.templateOf(agentId, pair.provider) : null;
  };
  return async (agentId, channel) => {
    const [templateId, status] = await Promise.all([
      templateOf(agentId, channel),
      deps.status(),
    ]);
    return { templateId, status };
  };
}

export async function lookUpProviderOutage(
  providerOutage: ChannelProviderOutage,
  agentId: string,
  channel: ChannelRef,
): Promise<ProviderOutageLookup | null> {
  try {
    return await providerOutage(agentId, channel);
  } catch (err) {
    getLogger().warn(
      { agentId, reason: formatError(err) },
      "channels.provider_outage_unread",
    );
    return null;
  }
}

type OutageCondition =
  | { kind: "no-outage" }
  | { kind: "degraded"; since: Date; statusPageUrl: string | null }
  | { kind: "dam-side" };

interface Messenger {
  time(at: Date): string;
  text(value: string): string;
}

function unixSeconds(at: Date): number {
  return Math.floor(at.getTime() / 1000);
}

function utcClock(at: Date): string {
  const hours = String(at.getUTCHours()).padStart(2, "0");
  const minutes = String(at.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes} UTC`;
}

const SLACK: Messenger = {
  time: (at) =>
    `<!date^${unixSeconds(at)}^{date_short_pretty} at {time}|${utcClock(at)}>`,
  text: escapeFrameText,
};

const TELEGRAM: Messenger = {
  time: (at) =>
    `![${utcClock(at)}](tg://time?unix=${unixSeconds(at)}&format=wt)`,
  text: (value) => value,
};

function conditionOf(lookup: ProviderOutageLookup | null): OutageCondition {
  if (!lookup) return { kind: "no-outage" };
  if (lookup.status.damSide) return { kind: "dam-side" };
  const outage = lookup.status.outages.find(
    (o) => o.templateId === lookup.templateId,
  );
  return outage
    ? {
        kind: "degraded",
        since: new Date(outage.since),
        statusPageUrl: outage.statusPageUrl,
      }
    : { kind: "no-outage" };
}

function providerNameOf(templateId: string | null): string {
  const type =
    templateId === null ? null : providerTypeForTemplateId(templateId);
  return type === null ? "The model provider" : PROVIDERS[type].displayName;
}

function outageCopy(
  lookup: ProviderOutageLookup | null,
  brandName: string,
  messenger: Messenger,
): string {
  const provider = messenger.text(providerNameOf(lookup?.templateId ?? null));
  const brand = messenger.text(brandName);
  return match(conditionOf(lookup))
    .with({ kind: "degraded" }, ({ since, statusPageUrl }) =>
      [
        `${provider} has had an outage since ${messenger.time(since)}, so this agent could not answer. Try again when it works again.`,
        ...(statusPageUrl ? [`${provider} status: ${statusPageUrl}`] : []),
      ].join("\n"),
    )
    .with(
      { kind: "dam-side" },
      () =>
        `${brand} cannot reach model providers, so this agent could not answer. The problem is on ${brand}'s side. Try again in a few minutes.`,
    )
    .with(
      { kind: "no-outage" },
      () =>
        `${provider} did not respond, so this agent could not answer. Try again in a few minutes. If it keeps failing, the agent's owner can switch it to another provider.`,
    )
    .exhaustive();
}

export function slackProviderOutageCopy(
  lookup: ProviderOutageLookup | null,
  brandName: string,
): string {
  return outageCopy(lookup, brandName, SLACK);
}

export function telegramProviderOutageCopy(
  lookup: ProviderOutageLookup | null,
  brandName: string,
): string {
  return outageCopy(lookup, brandName, TELEGRAM);
}
