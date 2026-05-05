import { skipToken, useQuery } from "@tanstack/react-query";

import { api } from "../../../api.js";

export const egressRulesKeys = {
  all: ["egress-rules"] as const,
  forAgent: (agentId: string | null) => [...egressRulesKeys.all, "agent", agentId] as const,
  currentPreset: (agentId: string | null) =>
    [...egressRulesKeys.all, "agent", agentId, "preset"] as const,
};

export function useEgressRulesForAgent(agentId: string | null) {
  return useQuery({
    queryKey: egressRulesKeys.forAgent(agentId),
    queryFn: agentId
      ? () => api.egressRules.listForAgent.query({ agentId })
      : skipToken,
    meta: { errorToast: "Couldn't load egress rules" },
  });
}

/** Derived from active `egress_rules.source` server-side: any `preset:all`
 *  row → "all"; any `preset:trusted` row → "trusted"; otherwise "none". */
export function useCurrentPreset(agentId: string | null) {
  return useQuery({
    queryKey: egressRulesKeys.currentPreset(agentId),
    queryFn: agentId
      ? () => api.egressRules.currentPreset.query({ agentId })
      : skipToken,
  });
}

/** Helm-mounted list of hosts the `trusted` preset would seed. Read once
 *  at boot on the server, so a long staleTime is fine. Used to render a
 *  preview of preset rules before the user commits the switch. */
export function useTrustedHosts() {
  return useQuery({
    queryKey: [...egressRulesKeys.all, "trusted-hosts"] as const,
    queryFn: () => api.egressRules.trustedHosts.query(),
    staleTime: 5 * 60_000,
  });
}
