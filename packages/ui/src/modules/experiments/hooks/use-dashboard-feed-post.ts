import { useQuery } from "@tanstack/react-query";
import { EXPERIMENT_FEED_MESSAGE_TYPE } from "api-server-api";
import { useMemo } from "react";

import { trpc } from "../../../trpc.js";
import { useExperimentFeed } from "../api/queries.js";

/** When an artifact docked in chat IS some experiment's dashboard, feed it:
 *  the renderer only comes alive through the postMessage bridge, so a
 *  manually opened dashboard would otherwise sit on its waiting state
 *  forever. Returns the postMessage payload, or undefined for every other
 *  artifact (the frame then behaves exactly as before). */
export function useDashboardFeedPost(artifactId: string | null): unknown {
  const { data: experiments } = useQuery({
    ...trpc.experiments.list.queryOptions(),
    enabled: artifactId !== null,
  });
  const experimentId =
    experiments?.find((e) => e.dashboardArtifactId === artifactId)?.id ?? null;
  const { data: feed } = useExperimentFeed(experimentId);
  return useMemo(
    () => (feed ? { type: EXPERIMENT_FEED_MESSAGE_TYPE, feed } : undefined),
    [feed],
  );
}
