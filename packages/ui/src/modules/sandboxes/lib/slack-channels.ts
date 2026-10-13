import { ChannelType, type SlackChannel } from "api-server-api";
import { match } from "ts-pattern";

import type { AgentView } from "../../../types.js";

export function findSlackChannels(
  agent: AgentView | undefined,
): SlackChannel[] {
  return agent?.channels.filter((c) => c.type === ChannelType.Slack) ?? [];
}

export function slackChannelLabel(channel: SlackChannel): string {
  if (!channel.label) return channel.slackChannelId;
  return match(channel.label)
    .with({ kind: "channel" }, (l) => `#${l.name}`)
    .with({ kind: "direct-message" }, (l) =>
      l.with ? `DM with ${l.with}` : "Direct message",
    )
    .with({ kind: "group-direct-message" }, (l) =>
      l.members.length > 0
        ? `Group DM with ${l.members.join(", ")}`
        : "Group DM",
    )
    .with({ kind: "gone" }, () => channel.slackChannelId)
    .exhaustive(() => channel.slackChannelId);
}

export function isSlackConversationGone(channel: SlackChannel): boolean {
  return channel.label?.kind === "gone";
}
