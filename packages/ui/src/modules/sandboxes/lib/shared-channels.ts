import type { SlackChannel } from "api-server-api";

import { slackChannelLabel } from "../hooks/use-slack-channel-form.js";

export interface TelegramChat {
  title: string;
  direct: boolean;
}

export type SharedChannel =
  | { kind: "slack-channel"; name: string | null }
  | { kind: "slack-group-dm" }
  | { kind: "telegram-chat"; name: string | null };

const isSlackDirectMessage = (channel: SlackChannel): boolean =>
  channel.label?.kind === "direct-message" ||
  channel.slackChannelId.startsWith("D");

const toSharedSlackChannel = (channel: SlackChannel): SharedChannel =>
  channel.label?.kind === "group-direct-message"
    ? { kind: "slack-group-dm" }
    : { kind: "slack-channel", name: slackChannelLabel(channel) };

export function sharedChannels(
  slack: readonly SlackChannel[],
  telegram: readonly TelegramChat[],
): SharedChannel[] {
  return [
    ...slack.filter((c) => !isSlackDirectMessage(c)).map(toSharedSlackChannel),
    ...telegram
      .filter((c) => !c.direct)
      .map((c): SharedChannel => ({ kind: "telegram-chat", name: c.title })),
  ];
}

const KIND_NOUN: Record<SharedChannel["kind"], [string, string]> = {
  "slack-channel": ["Slack channel", "Slack channels"],
  "slack-group-dm": ["Slack group DM", "Slack group DMs"],
  "telegram-chat": ["Telegram chat", "Telegram chats"],
};

export function sharedChannelsTitle(
  channels: readonly SharedChannel[],
): string {
  const [first] = channels;
  if (!first) return "";
  if (channels.length === 1) {
    if (first.kind === "slack-group-dm") return "a Slack group DM";
    const noun = KIND_NOUN[first.kind][0];
    return first.name ? `the ${noun} ${first.name}` : `this ${noun}`;
  }
  const kinds = new Set(channels.map((c) => c.kind));
  if (kinds.size === 1) return `${channels.length} ${KIND_NOUN[first.kind][1]}`;
  const telegram = kinds.has("telegram-chat");
  const slack = kinds.has("slack-channel") || kinds.has("slack-group-dm");
  const messengers =
    slack && telegram ? "Slack and Telegram" : slack ? "Slack" : "Telegram";
  return `${channels.length} ${messengers} conversations`;
}

export function namesOf(
  channels: readonly SharedChannel[],
  kind: "slack-channel" | "telegram-chat",
): string[] {
  return channels.flatMap((c) => (c.kind === kind && c.name ? [c.name] : []));
}
