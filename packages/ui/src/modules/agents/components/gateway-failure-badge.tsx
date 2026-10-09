import { Badge } from "@/components/ui/badge";

import type { AgentView } from "../../../types.js";

export function GatewayFailureBadge({
  agent,
}: {
  agent: Pick<AgentView, "gatewayFailure">;
}) {
  if (!agent.gatewayFailure) return null;
  return (
    <Badge
      variant="warning"
      title={`Network gateway: ${agent.gatewayFailure}`}
      data-testid="gateway-failure-badge"
    >
      Network gateway is failing
    </Badge>
  );
}
