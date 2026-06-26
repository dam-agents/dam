import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

// Start/stop change an experiment's status, so refetch both the list (status
// pill) and any open detail query. `get.queryKey()` with no input matches
// every cached detail.
const invalidatesListAndDetail = [
  trpc.experiments.list.queryKey(),
  trpc.experiments.get.queryKey(),
];

export function useCreateExperiment() {
  return useMutation({
    ...trpc.experiments.create.mutationOptions(),
    meta: {
      invalidates: [trpc.experiments.list.queryKey()],
      errorToast: "Failed to create experiment",
    },
  });
}

export function useAddArm() {
  return useMutation({
    ...trpc.experiments.addArm.mutationOptions(),
    meta: { errorToast: "Failed to add arm" },
  });
}

export function useStartExperiment() {
  return useMutation({
    ...trpc.experiments.start.mutationOptions(),
    meta: {
      invalidates: invalidatesListAndDetail,
      errorToast: "Failed to start experiment",
    },
  });
}

export function useStopExperiment() {
  return useMutation({
    ...trpc.experiments.stop.mutationOptions(),
    meta: {
      invalidates: invalidatesListAndDetail,
      errorToast: "Failed to stop experiment",
    },
  });
}
