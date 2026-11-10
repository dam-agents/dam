import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useWebSearchState(agentId: string | null) {
  return useQuery({
    ...trpc.webSearch.state.queryOptions(agentId ? { agentId } : skipToken),
    meta: { errorToast: "Couldn't load the web search settings" },
  });
}
