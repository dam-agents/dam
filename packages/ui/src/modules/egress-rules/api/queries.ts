import { skipToken, useQuery } from "@tanstack/react-query";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";

export const egressRulesKeys = {
  all: ["egress-rules"] as const,
  forAgent: (agentId: string | null) =>
    [...egressRulesKeys.all, "agent", agentId] as const,
  currentPreset: (agentId: string | null) =>
    [...egressRulesKeys.all, "agent", agentId, "preset"] as const,
};

const RULES_ERROR_TOAST = "Couldn't load egress rules";

export function useEgressRulesForAgent(agentId: string | null) {
  return useQuery({
    queryKey: egressRulesKeys.forAgent(agentId),
    queryFn: agentId
      ? () => api.egressRules.listForAgent.query({ agentId })
      : skipToken,
    meta: { errorToast: RULES_ERROR_TOAST },
  });
}

export function fetchEgressRulesForAgent(agentId: string) {
  return queryClient.fetchQuery({
    queryKey: egressRulesKeys.forAgent(agentId),
    queryFn: () => api.egressRules.listForAgent.query({ agentId }),
    staleTime: 0,
    retry: false,
    meta: { errorToast: RULES_ERROR_TOAST },
  });
}

export function useCurrentPreset(agentId: string | null) {
  return useQuery({
    queryKey: egressRulesKeys.currentPreset(agentId),
    queryFn: agentId
      ? () => api.egressRules.currentPreset.query({ agentId })
      : skipToken,
  });
}

export function useTrustedHosts() {
  return useQuery({
    queryKey: [...egressRulesKeys.all, "trusted-hosts"] as const,
    queryFn: () => api.egressRules.trustedHosts.query(),
    staleTime: 5 * 60_000,
  });
}
