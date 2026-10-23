import { useQuery } from "@tanstack/react-query";
import { EXPERIMENT_FEED_MESSAGE_TYPE } from "api-server-api";
import { useMemo } from "react";

import { trpc } from "../../../trpc.js";
import { useExperimentFeed } from "../api/queries.js";

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
