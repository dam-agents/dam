/** One write a save of the Slack channel form performs. An agent may hold
 *  several bindings, so every step names the conversation it acts on. */
export type SlackChannelSaveStep =
  | {
      kind: "connect";
      input: { id: string; slackChannelId: string; ambient?: true };
    }
  | { kind: "disconnect"; input: { id: string; slackChannelId: string } };

/** The writes a save performs, in the order they must run.
 *
 *  Moving a binding to another conversation connects the new one **first** and
 *  releases the old one only once that succeeded, so a refused connect — the
 *  conversation belongs to another agent, a transient failure — leaves the
 *  existing binding untouched. Releasing first loses the binding on any such
 *  failure (#2949). An interrupted move leaves both conversations connected,
 *  which an agent is allowed to be and the card lists, so the user can retry
 *  the save (every step is idempotent) or release the stale one. */
export function planSlackChannelSave(args: {
  agentId: string;
  /** The binding being edited; undefined when connecting a new conversation. */
  channel: { slackChannelId: string; ambient?: boolean } | undefined;
  values: { channelId: string; ambient: boolean };
}): SlackChannelSaveStep[] {
  const { agentId, channel, values } = args;
  const connect = {
    kind: "connect",
    input: {
      id: agentId,
      slackChannelId: values.channelId,
      ...(values.ambient ? { ambient: true as const } : {}),
    },
  } satisfies SlackChannelSaveStep;

  if (!channel) return [connect];
  if (values.channelId !== channel.slackChannelId)
    return [
      connect,
      {
        kind: "disconnect",
        input: { id: agentId, slackChannelId: channel.slackChannelId },
      },
    ];
  // Ambient is the one mutable field of a binding: a same-conversation
  // re-connect updates it in place. Nothing changed means nothing to write.
  return values.ambient !== (channel.ambient ?? false) ? [connect] : [];
}
