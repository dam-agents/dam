import { Badge } from "@/components/ui/badge";

import { useKitUpdate } from "../api/queries.js";

export function KitUpdateTag({ agentId }: { agentId: string }) {
  const update = useKitUpdate(agentId);
  if (update?.state !== "available") return null;
  return (
    <Badge
      variant="kit"
      className="shrink-0 cursor-default"
      title="A newer version of this agent's starter kit is available. Open the agent to update it."
      data-testid="agent-kit-update-badge"
    >
      Kit update
    </Badge>
  );
}
