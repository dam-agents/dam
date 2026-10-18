import { Badge } from "@/components/ui/badge";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";

export function GatewayFailureBadge({
  agent,
}: {
  agent: Pick<AgentView, "id" | "gatewayFailure">;
}) {
  const restarting = useStore((s) => s.restartingAgents.has(agent.id));
  if (!agent.gatewayFailure || restarting) return null;
  return (
    <Badge
      variant="danger"
      title={`Network access: ${agent.gatewayFailure}`}
      data-testid="gateway-failure-badge"
    >
      Network access is failing
    </Badge>
  );
}
