import { useMutation } from "@tanstack/react-query";

import { api } from "../../../api.js";
import { trpc } from "../../../trpc.js";
import { agentsKeys } from "../../agents/api/queries.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the profile a channel's turns run on (D91), set
 * from the channel's own row; it changes nothing a running thread holds, so no
 * session is restarted for it. The list is refetched because the row carries
 * the channel, profile included.
 */
export function useSetChannelProfile(agentId: string) {
  return useMutation({
    mutationFn: (input: {
      type: "slack" | "telegram";
      slackChannelId?: string;
      conversationId?: string;
      profileId: string | null;
    }) => api.channels.setProfile.mutate({ agentId, ...input }),
    meta: {
      invalidates: [agentsKeys.listWithChannels(), trpc.profiles.pathKey()],
      errorToast: "Couldn't set the channel's profile",
    },
  });
}
