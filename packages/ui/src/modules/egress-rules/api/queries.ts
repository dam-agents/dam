import { skipToken, useQuery } from "@tanstack/react-query";

import { platform } from "../../../platform.js";

export const egressRulesKeys = {
  all: ["egress-rules"] as const,
  forAgent: (agentId: string | null) => [...egressRulesKeys.all, "agent", agentId] as const,
};

export function useEgressRulesForAgent(agentId: string | null) {
  return useQuery({
    queryKey: egressRulesKeys.forAgent(agentId),
    queryFn: agentId
      ? () => platform.egressRules.listForAgent.query({ agentId })
      : skipToken,
    meta: { errorToast: "Couldn't load egress rules" },
  });
}

/** Helm-mounted list of hosts the `trusted` preset would seed. Read once
 *  at boot on the server, so a long staleTime is fine. Used to render a
 *  preview of preset rules before the user commits the switch. */
export function useTrustedHosts() {
  return useQuery({
    queryKey: [...egressRulesKeys.all, "trusted-hosts"] as const,
    queryFn: () => platform.egressRules.trustedHosts.query(),
    staleTime: 5 * 60_000,
  });
}
