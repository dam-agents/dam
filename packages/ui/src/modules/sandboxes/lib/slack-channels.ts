import { ChannelType, type SlackChannel } from "api-server-api";
import { match } from "ts-pattern";

import type { AgentView } from "../../../types.js";

/* UNIT_BOUNDARY_DESCRIPTION: the Slack bindings of an Agent; a channel row
 * carries the profile its turns run on (D91) and when it was created, which the
 * bind dialog reads to start a new one on the same profile. */
export type SlackChannelBinding = NonNullable<AgentView["channels"]>[number];

export function findSlackChannels(
  agent: AgentView | undefined,
): SlackChannelBinding[] {
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
