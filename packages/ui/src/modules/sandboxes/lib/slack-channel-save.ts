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
  ambient?: boolean;
  history?: boolean;
  customEmoji?: string[] | null;
} | null {
  const { agentId, channel, values } = args;
  const customEmoji = values.customEmoji ?? null;
  const emojiChanged =
    JSON.stringify(customEmoji) !==
    JSON.stringify(channel?.customEmoji ?? null);
  const emoji = emojiChanged ? { customEmoji } : {};

  if (!channel)
    return {
      id: agentId,
      slackChannelId: values.channelId,
      ...(values.ambient ? { ambient: true } : {}),
      ...(values.history ? { history: true } : {}),
      ...emoji,
    };
  const ambientChanged = values.ambient !== (channel.ambient ?? false);
  const historyChanged = values.history !== (channel.history ?? false);
  if (!ambientChanged && !historyChanged && !emojiChanged) return null;
  return {
    id: agentId,
    slackChannelId: channel.slackChannelId,
    ...(ambientChanged ? { ambient: values.ambient } : {}),
    ...(historyChanged ? { history: values.history } : {}),
    ...emoji,
  };
}
