import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import { useFeatures } from "../../features/api/queries.js";

export function useEnvironmentsEnabled(): boolean {
  return useFeatures().data?.environments ?? false;
}

// UNIT_BOUNDARY_DESCRIPTION: an agent's Environments, polled while a surface shows them, because the agent's own update_environment changes only the row and raises no hint; a surface that only reads the count opts out, since every create and delete touches the Environment's Agent and raises an agents hint.
export function useEnvironments(
  owningAgentId: string | null,
  { poll = true }: { poll?: boolean } = {},
) {
  return useQuery({
    ...trpc.environments.list.queryOptions(
      owningAgentId ? { owningAgentId } : skipToken,
    ),
    staleTime: 5000,
    refetchInterval: poll ? 15_000 : false,
    meta: { errorToast: "Couldn't refresh Environments" },
  });
}

export function useEnvironmentAccessList(owningAgentId: string | null) {
  return useQuery({
    ...trpc.environments.accessList.queryOptions(
      owningAgentId ? { owningAgentId } : skipToken,
    ),
    meta: { errorToast: "Couldn't load who may open Environments" },
  });
}
