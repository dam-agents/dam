import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

// Every experiment mutation changes lifecycle state the list, the index's
// driver summaries, detail, and feed all render, so refetch the lot.
const invalidatesExperiments = [
  trpc.experiments.list.queryKey(),
  trpc.experiments.driverSummaries.queryKey(),
  trpc.experiments.feed.queryKey(),
];

export function useStartRun() {
  return useMutation({
    ...trpc.experiments.startRun.mutationOptions(),
    meta: {
      invalidates: invalidatesExperiments,
      errorToast: "Failed to start the run",
    },
  });
}

export function useStopExperiment() {
  return useMutation({
    ...trpc.experiments.stop.mutationOptions(),
    meta: {
      invalidates: invalidatesExperiments,
      errorToast: "Failed to stop experiment",
    },
  });
}

export function useDeleteExperiment() {
  return useMutation({
    ...trpc.experiments.delete.mutationOptions(),
    meta: {
      invalidates: invalidatesExperiments,
      errorToast: "Failed to delete experiment",
    },
  });
}
