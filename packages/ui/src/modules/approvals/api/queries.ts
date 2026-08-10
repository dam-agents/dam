import { skipToken, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { api } from "../../../api.js";

const REFETCH_INTERVAL_MS = 2000;

export const approvalsKeys = {
  all: ["approvals"] as const,
  forOwner: () => [...approvalsKeys.all, "owner"] as const,
  forAgent: (agentId: string | null) =>
    [...approvalsKeys.all, "agent", agentId] as const,
};

/** Owner-wide approvals (all statuses). Polled — Redis pub/sub fans the synth
 *  frame to the live WS; the inbox itself is a DB read and refetches
 *  enough to surface a new pending without a hard reload. */
export function useApprovalsForOwner() {
  return useQuery({
    queryKey: approvalsKeys.forOwner(),
    queryFn: () => api.approvals.listForOwner.query(),
    refetchInterval: REFETCH_INTERVAL_MS,
    staleTime: REFETCH_INTERVAL_MS,
    meta: { errorToast: "Couldn't load approvals" },
  });
}

/** Pending approvals only — derived from the owner-wide query. */
export function usePendingApprovals() {
  const { data, ...rest } = useApprovalsForOwner();
  const pending = useMemo(
    () => (data ?? []).filter((r) => r.status === "pending"),
    [data],
  );
  return { data: pending, ...rest };
}

/** Resolved + expired approvals — the history view. */
export function useApprovalHistory() {
  const { data, ...rest } = useApprovalsForOwner();
  const history = useMemo(
    () =>
      (data ?? [])
        .filter((r) => r.status === "resolved" || r.status === "expired")
        .sort(
          (a, b) =>
            Date.parse(b.resolvedAt ?? b.createdAt) -
            Date.parse(a.resolvedAt ?? a.createdAt),
        ),
    [data],
  );
  return { data: history, ...rest };
}

export function useApprovalsForAgent(agentId: string | null) {
  return useQuery({
    queryKey: approvalsKeys.forAgent(agentId),
    queryFn: agentId
      ? () => api.approvals.listForInstance.query({ agentId })
      : skipToken,
    refetchInterval: REFETCH_INTERVAL_MS,
    staleTime: REFETCH_INTERVAL_MS,
    meta: { errorToast: "Couldn't load agent approvals" },
  });
}
