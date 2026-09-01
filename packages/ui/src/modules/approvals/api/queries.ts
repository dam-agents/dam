import { skipToken, useQuery } from "@tanstack/react-query";

import { api } from "../../../api.js";

export const approvalsKeys = {
  all: ["approvals"] as const,
  forOwner: () => [...approvalsKeys.all, "owner"] as const,
  forAgent: (agentId: string | null) =>
    [...approvalsKeys.all, "agent", agentId] as const,
};

const OWNER_APPROVALS_POLL_MS = 30_000;

export function useApprovalsForOwner() {
  return useQuery({
    queryKey: approvalsKeys.forOwner(),
    queryFn: () => api.approvals.listForOwner.query(),
    refetchInterval: OWNER_APPROVALS_POLL_MS,
    meta: { errorToast: "Couldn't load approvals" },
  });
}

export function useApprovalsForAgent(agentId: string | null) {
  return useQuery({
    queryKey: approvalsKeys.forAgent(agentId),
    queryFn: agentId
      ? () => api.approvals.listForInstance.query({ agentId })
      : skipToken,
    meta: { errorToast: "Couldn't load agent approvals" },
  });
}
