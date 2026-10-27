import { useMutation } from "@tanstack/react-query";
import type { SessionChoiceReferences, SessionPair } from "api-server-api";

import { api } from "../../../api.js";
import { trpc } from "../../../trpc.js";
import { agentsKeys } from "../../agents/api/queries.js";
import { telegramChatsQueryOptions } from "../../telegram/api/queries.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a channel's turns run on (D91), set from the
 * channel's own row in the chat default's shape; it changes nothing a running
 * thread holds, so no session is restarted for it. The list is refetched
 * because the row carries the channel's pick.
 */
export function useSetChannelChoice(agentId: string) {
  return useMutation({
    mutationFn: (
      input: {
        type: "slack" | "telegram";
        slackChannelId?: string;
        conversationId?: string;
        pair: SessionPair | null;
      } & SessionChoiceReferences,
    ) => api.channels.setChoice.mutate({ agentId, ...input }),
    /* UNIT_BOUNDARY_DESCRIPTION: a Slack row reads the agent's channel list and
     * a Telegram row its bound chats, and a chat's pick lives on the binding
     * row, so both are refetched rather than one; the owner's profiles are
     * refetched too, since what a channel runs on is part of a profile's usage. */
    meta: {
      invalidates: [
        agentsKeys.listWithChannels(),
        telegramChatsQueryOptions(agentId).queryKey,
        trpc.profiles.list.queryKey(),
      ],
    },
  });
}
