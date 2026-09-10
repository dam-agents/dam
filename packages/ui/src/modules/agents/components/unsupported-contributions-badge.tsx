import { Badge } from "@/components/ui/badge";

import type { AgentView } from "../../../types.js";
import { contributionKindList } from "../lib/contribution-kind-labels.js";

export function UnsupportedContributionsBadge({ agent }: { agent: AgentView }) {
  const kinds = agent.unsupportedContributionKinds;
  if (kinds.length === 0) return null;
  const remedy = agent.templateUpdate
    ? "Update the agent to apply them."
    : "No runtime update is available yet.";
  return (
    <Badge
      variant="warning"
      title={`This agent's runtime is too old to accept ${contributionKindList(kinds)} it was granted. ${remedy}`}
    >
      Missing config
    </Badge>
  );
}
