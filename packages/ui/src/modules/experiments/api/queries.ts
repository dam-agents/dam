import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

/** Experiments list. Refresh-on-open, no live updates (epic decision D7): the
 *  destination refetches when it mounts but does not poll. */
export function useExperiments() {
  return useQuery({
    ...trpc.experiments.list.queryOptions(),
    refetchOnMount: "always",
    staleTime: 0,
    meta: { errorToast: "Couldn't load experiments" },
  });
}

/** A single experiment with its arms and run ledgers. Same refresh-on-open
 *  semantics as the list. */
export function useExperiment(id: string | null) {
  return useQuery({
    ...trpc.experiments.get.queryOptions(id ? { id } : skipToken),
    refetchOnMount: "always",
    staleTime: 0,
    meta: { errorToast: "Couldn't load experiment" },
  });
}
