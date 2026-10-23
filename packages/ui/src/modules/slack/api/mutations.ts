import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import { agentsKeys } from "../../agents/api/queries.js";

export function useBindSlackChannel() {
  return useMutation({
    ...trpc.agents.bindSlackChannel.mutationOptions(),
    meta: {
      invalidates: [agentsKeys.listWithChannels(), trpc.agents.list.queryKey()],
    },
  });
}
