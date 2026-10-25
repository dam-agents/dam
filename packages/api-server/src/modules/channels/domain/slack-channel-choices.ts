export interface SlackChannelChoice {
  id: string;
  name: string;
  teamId: string;
  isPrivate: boolean;
}

export type SlackChannelChoices =
  { linked: false } | { linked: true; channels: SlackChannelChoice[] };

export type SlackChannelMembership = "member" | "not-member" | "unlinked";

export interface SlackWorkspaceReach {
  teamId: string;
  botChannels: { id: string; name: string; isPrivate: boolean }[];
  sharedChannelIds: ReadonlySet<string>;
}

// UNIT_BOUNDARY_DESCRIPTION: a person may connect an Agent only to a Slack channel they and the bot are both in, so the channels offered are the bot's channels the person also shares. An organization shares one channel into many workspaces under one id; it is offered once, under the first workspace that reaches it, the way a bind settles on the workspace connected first.
export function pickableSlackChannels(
  reach: SlackWorkspaceReach[],
): SlackChannelChoice[] {
  const seen = new Set<string>();
  const choices: SlackChannelChoice[] = [];
  for (const workspace of reach) {
    for (const channel of workspace.botChannels) {
      if (seen.has(channel.id)) continue;
      if (!workspace.sharedChannelIds.has(channel.id)) continue;
      seen.add(channel.id);
      choices.push({ ...channel, teamId: workspace.teamId });
    }
  }
  return choices.sort((a, b) => a.name.localeCompare(b.name));
}

export function withWorkspaceNames(
  choices: SlackChannelChoices,
  workspaceNames: ReadonlyMap<string, string | null>,
) {
  if (!choices.linked) return choices;
  return {
    linked: true as const,
    channels: choices.channels.map(({ teamId, ...channel }) => ({
      ...channel,
      workspace: workspaceNames.get(teamId) ?? null,
    })),
  };
}
