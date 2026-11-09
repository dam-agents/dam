export function planSlackChannelSave(args: {
  agentId: string;
  channel:
    | {
        slackChannelId: string;
        ambient?: boolean;
        history?: boolean;
        customEmoji?: string[] | null;
      }
    | undefined;
  values: {
    channelId: string;
    ambient: boolean;
    history: boolean;
    customEmoji?: string[] | null;
  };
}): {
  id: string;
  slackChannelId: string;
  ambient?: true;
  history?: true;
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
    ...(values.history ? { history: true as const } : {}),
    ...(emojiChanged ? { customEmoji } : {}),
  });

  if (!channel) return connect(values.channelId);
  const unchanged =
    values.ambient === (channel.ambient ?? false) &&
    values.history === (channel.history ?? false) &&
    !emojiChanged;
  return unchanged ? null : connect(channel.slackChannelId);
}
