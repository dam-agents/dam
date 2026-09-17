import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useSlackBindFlow(flowId: string | null) {
  return useQuery({
    ...trpc.agents.peekSlackBindFlow.queryOptions(
      flowId ? { flowId } : skipToken,
    ),
    staleTime: Infinity,
    retry: false,
  });
}
