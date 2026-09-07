import { skipToken, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { trpc } from "../../../trpc.js";

export function useDriverSummaries(opts?: { silent?: boolean }) {
  return useQuery({
    ...trpc.experiments.driverSummaries.queryOptions(),
    refetchOnMount: "always",
    staleTime: 0,
    ...(opts?.silent
      ? {}
      : { meta: { errorToast: "Couldn't load experiments" } }),
  });
}

export function useAgentExperimentsLive(agentId: string | null) {
  const { data } = useQuery({
    ...trpc.experiments.list.queryOptions(),
    enabled: agentId !== null,
    refetchOnMount: "always",
    staleTime: 0,
  });
  return useMemo(
    () => (data ?? []).filter((e) => e.driverAgentId === agentId),
    [data, agentId],
  );
}

export function useExperimentFeed(id: string | null) {
  return useQuery({
    ...trpc.experiments.feed.queryOptions(id ? { id } : skipToken),
    refetchOnMount: "always",
    staleTime: 0,
    meta: { errorToast: "Couldn't load experiment feed" },
  });
}
