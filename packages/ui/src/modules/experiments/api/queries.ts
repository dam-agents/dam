import { skipToken, useQuery } from "@tanstack/react-query";
import type { Experiment, TraceFeed } from "api-server-api";
import { useMemo } from "react";

import { trpc } from "../../../trpc.js";

/** Poll cadence for a live experiment — span granularity is seconds, so a
 *  2.5 s staleness is invisible; terminal experiments stop polling. */
const LIVE_POLL_MS = 2500;

function isLive(status: Experiment["status"] | undefined): boolean {
  // Drafts stay warm too: a plan re-registration should show up unprompted.
  return status === "running" || status === "draft";
}

/** Experiments list. Refresh-on-open, no poll — matches the platform's
 *  list-view posture; the agent-card chip shares this query. */
export function useExperiments() {
  return useQuery({
    ...trpc.experiments.list.queryOptions(),
    refetchOnMount: "always",
    staleTime: 0,
    meta: { errorToast: "Couldn't load experiments" },
  });
}

/** The list as background context on non-experiment surfaces (the artifact
 *  library's run grouping): silent on error. */
export function useExperimentsAmbient() {
  return useQuery({
    ...trpc.experiments.list.queryOptions(),
    refetchOnMount: "always",
    staleTime: 0,
  });
}

/** The Experiments destination rows: driver agents + what they're doing.
 *  Refresh-on-open like every list. */
export function useDriverSummaries(opts?: { silent?: boolean }) {
  return useQuery({
    ...trpc.experiments.driverSummaries.queryOptions(),
    refetchOnMount: "always",
    staleTime: 0,
    // Ambient consumers (row subtitles) degrade the segment instead of
    // toasting about a page the user isn't on.
    ...(opts?.silent
      ? {}
      : { meta: { errorToast: "Couldn't load experiments" } }),
  });
}

/** This agent's experiments, newest first, polled while the chat is open so
 *  a plan registered mid-conversation docks its panel without a reload. */
export function useAgentExperimentsLive(agentId: string | null) {
  const { data } = useQuery({
    ...trpc.experiments.list.queryOptions(),
    enabled: agentId !== null,
    refetchOnMount: "always",
    staleTime: 0,
    // No error toast: this is ambient chat-dock polling, not a user action.
    refetchInterval: LIVE_POLL_MS * 2,
  });
  return useMemo(
    () => (data ?? []).filter((e) => e.driverAgentId === agentId),
    [data, agentId],
  );
}

/** The Trace Feed the dashboard renders — polled only while the run is live
 *  (the scoped revision of the no-polling posture for experiments). */
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
