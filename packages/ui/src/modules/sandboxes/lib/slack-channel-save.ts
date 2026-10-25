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

/**
 * UNIT_BOUNDARY_DESCRIPTION: a Slack binding is made first and the profile its
 * turns run on (D91) is written after it, awaited: the dialog cannot report a
 * channel set up while the row that says what it runs on was never written. A
 * profile write that fails is reported with the binding left in place, so the
 * row can set it again.
 */
export async function saveSlackChannel(input: {
  connect: () => Promise<unknown>;
  setProfile: (() => Promise<unknown>) | null;
}): Promise<{ profileError: unknown } | null> {
  await input.connect();
  if (input.setProfile === null) return null;
  try {
    await input.setProfile();
    return null;
  } catch (profileError) {
    return { profileError };
  }
}
