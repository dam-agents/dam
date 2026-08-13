export function planSlackChannelSave(args: {
  agentId: string;
  channel: { slackChannelId: string; ambient?: boolean } | undefined;
  values: { channelId: string; ambient: boolean };
}): { id: string; slackChannelId: string; ambient?: true } | null {
  const { agentId, channel, values } = args;
  const connect = (slackChannelId: string) => ({
    id: agentId,
    slackChannelId,
    ...(values.ambient ? { ambient: true as const } : {}),
  });

  if (!channel) return connect(values.channelId);
  return values.ambient === (channel.ambient ?? false)
    ? null
    : connect(channel.slackChannelId);
}
