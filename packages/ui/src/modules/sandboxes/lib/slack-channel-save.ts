export function planSlackChannelSave(args: {
  agentId: string;
  channel:
    | {
        slackChannelId: string;
        ambient?: boolean;
        whisper?: boolean;
        customEmoji?: string[] | null;
      }
    | undefined;
  values: {
    channelId: string;
    ambient: boolean;
    whisper?: boolean;
    customEmoji?: string[] | null;
  };
}): {
  id: string;
  slackChannelId: string;
  ambient?: true;
  whisper?: boolean;
  customEmoji?: string[] | null;
} | null {
  const { agentId, channel, values } = args;
  const customEmoji = values.customEmoji ?? null;
  const emojiChanged =
    JSON.stringify(customEmoji) !==
    JSON.stringify(channel?.customEmoji ?? null);
  const whisperChanged =
    values.whisper !== undefined &&
    values.whisper !== (channel?.whisper ?? true);
  const connect = (slackChannelId: string) => ({
    id: agentId,
    slackChannelId,
    ...(values.ambient ? { ambient: true as const } : {}),
    ...(whisperChanged ? { whisper: values.whisper } : {}),
    ...(emojiChanged ? { customEmoji } : {}),
  });

  if (!channel) return connect(values.channelId);
  return values.ambient === (channel.ambient ?? false) &&
    !emojiChanged &&
    !whisperChanged
    ? null
    : connect(channel.slackChannelId);
}
