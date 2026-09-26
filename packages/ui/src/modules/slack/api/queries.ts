import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import { fetchSlackInstallAvailability } from "./install.js";

const slackInstallKeys = {
  availability: () => ["slack", "install", "availability"] as const,
};

export function useSlackInstallAvailability() {
  return useQuery({
    queryKey: slackInstallKeys.availability(),
    queryFn: fetchSlackInstallAvailability,
    staleTime: 5 * 60_000,
    meta: { errorToast: "Couldn't check whether you can connect a workspace" },
  });
}

export function useSlackBindFlow(flowId: string | null) {
  return useQuery({
    ...trpc.agents.peekSlackBindFlow.queryOptions(
      flowId ? { flowId } : skipToken,
    ),
    staleTime: Infinity,
    retry: false,
  });
}
