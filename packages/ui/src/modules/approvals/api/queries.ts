import { skipToken, useQuery } from "@tanstack/react-query";

import { platform } from "../../../platform.js";

const REFETCH_INTERVAL_MS = 5000;

export const approvalsKeys = {
  all: ["approvals"] as const,
  forOwner: () => [...approvalsKeys.all, "owner"] as const,
  forInstance: (instanceId: string | null) =>
    [...approvalsKeys.all, "instance", instanceId] as const,
};

/** Owner-wide pending approvals. Polled — Redis pub/sub fans the synth
 *  frame to the live WS; the inbox itself is a DB read and refetches
 *  enough to surface a new pending without a hard reload. */
export function useApprovalsForOwner() {
  return useQuery({
    queryKey: approvalsKeys.forOwner(),
    queryFn: () => platform.approvals.listForOwner.query(),
    refetchInterval: REFETCH_INTERVAL_MS,
    staleTime: REFETCH_INTERVAL_MS,
    meta: { errorToast: "Couldn't load approvals" },
  });
}

export function useApprovalsForInstance(instanceId: string | null) {
  return useQuery({
    queryKey: approvalsKeys.forInstance(instanceId),
    queryFn: instanceId
      ? () => platform.approvals.listForInstance.query({ instanceId })
      : skipToken,
    refetchInterval: REFETCH_INTERVAL_MS,
    staleTime: REFETCH_INTERVAL_MS,
    meta: { errorToast: "Couldn't load instance approvals" },
  });
}
