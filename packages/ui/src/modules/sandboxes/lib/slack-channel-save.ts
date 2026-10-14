export function planSlackChannelSave(args: {
  agentId: string;
  channel:
    | {
        slackChannelId: string;
        ambient?: boolean;
        customEmoji?: string[] | null;
      }
    | undefined;
  values: {
    channelId: string;
    ambient: boolean;
    customEmoji?: string[] | null;
  };
}): {
  id: string;
  slackChannelId: string;
  ambient?: true;
  customEmoji?: string[] | null;
} | null {
  const { agentId, channel, values } = args;
  const customEmoji = values.customEmoji ?? null;
  const emojiChanged =
    JSON.stringify(customEmoji) !==
    JSON.stringify(channel?.customEmoji ?? null);
  const connect = (slackChannelId: string) => ({
    id: agentId,
    slackChannelId,
    ...(values.ambient ? { ambient: true as const } : {}),
    ...(emojiChanged ? { customEmoji } : {}),
  });

  if (!channel) return connect(values.channelId);
  return values.ambient === (channel.ambient ?? false) && !emojiChanged
    ? null
    : connect(channel.slackChannelId);
}
