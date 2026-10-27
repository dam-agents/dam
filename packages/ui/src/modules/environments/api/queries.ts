import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import { useFeatures } from "../../features/api/queries.js";

export function useEnvironmentsEnabled(): boolean {
  return useFeatures().data?.environments ?? false;
}

// UNIT_BOUNDARY_DESCRIPTION: an agent's Environments, for the surfaces that only need to know whether it has any: every create and delete touches the Environment's Agent and raises an agents hint, so the count needs no poll.
export function useEnvironments(owningAgentId: string | null) {
  return useQuery({
    ...trpc.environments.list.queryOptions(
      owningAgentId ? { owningAgentId } : skipToken,
    ),
    staleTime: 5000,
    meta: { errorToast: "Couldn't refresh Environments" },
  });
}

// UNIT_BOUNDARY_DESCRIPTION: every Environment of the signed-in owner, across their agents, polled while the Artifacts list shows them, because the agent's own update_environment changes only the row and raises no hint.
export function useAllEnvironments(enabled: boolean) {
  return useQuery({
    ...trpc.environments.listAll.queryOptions(enabled ? undefined : skipToken),
    staleTime: 5000,
    refetchInterval: 15_000,
    meta: { errorToast: "Couldn't refresh Environments" },
  });
}

export function useAgentEnvironmentMembers(owningAgentId: string | null) {
  return useQuery({
    ...trpc.environments.agentMembers.queryOptions(
      owningAgentId ? { owningAgentId } : skipToken,
    ),
    meta: { errorToast: "Couldn't load the agent's Environment members" },
  });
}
