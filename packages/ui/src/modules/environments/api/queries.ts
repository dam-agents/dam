import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import { useFeatures } from "../../features/api/queries.js";

export function useEnvironmentsEnabled(): boolean {
  return useFeatures().data?.environments ?? false;
}

export function useEnvironments(owningAgentId: string | null) {
  return useQuery({
    ...trpc.environments.list.queryOptions(
      owningAgentId ? { owningAgentId } : skipToken,
    ),
    staleTime: 5000,
    refetchInterval: 15_000,
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
