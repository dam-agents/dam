import type { SlackChannel } from "../agents/types.js";

export interface TelegramChatAudience {
  title: string;
  direct: boolean;
}

export type SharedChannel =
  | { kind: "slack-channel"; name: string | null }
  | { kind: "slack-group-dm" }
  | { kind: "telegram-chat"; name: string | null }
  | { kind: "unknown-conversation" };

export const isSlackDirectMessageId = (slackChannelId: string): boolean =>
  slackChannelId.startsWith("D");

const isSlackDirectMessage = (
  channel: Pick<SlackChannel, "slackChannelId" | "label">,
): boolean =>
  channel.label?.kind === "direct-message" ||
  isSlackDirectMessageId(channel.slackChannelId);

const toSharedSlackChannel = (
  channel: Pick<SlackChannel, "slackChannelId" | "label">,
): SharedChannel =>
  channel.label?.kind === "group-direct-message"
    ? { kind: "slack-group-dm" }
    : {
        kind: "slack-channel",
        name:
          channel.label?.kind === "channel"
            ? `#${channel.label.name}`
            : channel.slackChannelId,
      };

/**
 * UNIT_BOUNDARY_DESCRIPTION: The conversations an Agent's channel bindings
 * share its connections and satellites with: every Slack channel and group DM
 * and every Telegram group, since anyone the messenger admits there steers the
 * Agent. A 1:1 DM is the binder's own and shares nothing. The web app's
 * sharing confirmations and the CLI's sharing warning both read this one rule,
 * so the two cannot disagree on who can steer an Agent.
 */
export function sharedChannels(
  slack: readonly Pick<SlackChannel, "slackChannelId" | "label">[],
  telegram: readonly TelegramChatAudience[],
): SharedChannel[] {
  return [
    ...slack.filter((c) => !isSlackDirectMessage(c)).map(toSharedSlackChannel),
    ...telegram
      .filter((c) => !c.direct)
      .map((c): SharedChannel => ({ kind: "telegram-chat", name: c.title })),
  ];
}
