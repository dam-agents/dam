import type { ApiClient } from "./api-client.js";

export const ownerSlackUserId = "U-E2E-OWNER";

export async function connectSlackAsMember(
  api: ApiClient,
  input: {
    id: string;
    slackChannelId: string;
    ambient?: boolean;
    teamId?: string;
  },
) {
  const { teamId, ...connect } = input;
  await api.e2e.slackAddMember.mutate({
    slackUserId: ownerSlackUserId,
    channelId: input.slackChannelId,
    ...(teamId !== undefined ? { teamId } : {}),
  });
  return api.agents.connectSlack.mutate(connect);
}
