/** The connect a save of the Slack channel form performs, or null when nothing
 *  changed. Connecting is the only write the form can make — releasing a
 *  binding belongs to the card's own disconnect, behind its confirmation.
 *
 *  A binding's conversation is its identity, so an edit never moves one: it
 *  re-connects the conversation being edited, which updates ambient in place.
 *  Listening somewhere else is a connect of the other conversation plus a
 *  release of this one — two deliberate acts, not one compound write that
 *  could release a binding it then fails to replace (#2949). */
export function planSlackChannelSave(args: {
  agentId: string;
  /** The binding being edited; undefined when connecting a new conversation. */
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
  // Ambient is the one field of a binding that changes in place; nothing else
  // about it is editable, so an unchanged flag means nothing to write.
  return values.ambient === (channel.ambient ?? false)
    ? null
    : connect(channel.slackChannelId);
}
