import { skipToken, useQuery } from "@tanstack/react-query";
import type { Experiment, TraceFeed } from "api-server-api";
import { useMemo } from "react";

import { trpc } from "../../../trpc.js";

const LIVE_POLL_MS = 2500;

function isLive(status: Experiment["status"] | undefined): boolean {
  return status === "running" || status === "draft";
}

export function useExperiments() {
  return useQuery({
    ...trpc.experiments.list.queryOptions(),
    refetchOnMount: "always",
    staleTime: 0,
    meta: { errorToast: "Couldn't load experiments" },
  });
}

export function useExperimentsAmbient() {
  return useQuery({
    ...trpc.experiments.list.queryOptions(),
    refetchOnMount: "always",
    staleTime: 0,
  });
}

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
    refetchInterval: LIVE_POLL_MS * 2,
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
    refetchInterval: (query) => {
      const feed = query.state.data as TraceFeed | undefined;
      return isLive(feed?.experiment.status) ? LIVE_POLL_MS : false;
    },
    meta: { errorToast: "Couldn't load experiment feed" },
  });
}
