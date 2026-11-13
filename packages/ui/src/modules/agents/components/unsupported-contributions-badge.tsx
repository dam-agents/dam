import { Badge } from "@/components/ui/badge";

import type { AgentView } from "../../../types.js";
import { contributionKindList } from "../lib/contribution-kind-labels.js";

export function UnsupportedContributionsBadge({ agent }: { agent: AgentView }) {
  const kinds = agent.unsupportedContributionKinds ?? [];
  if (kinds.length === 0) return null;
  return (
    <Badge
      variant="warning"
      title={`This agent doesn't accept ${contributionKindList(kinds)} it was granted yet, so it runs without them.`}
    >
      Missing config
    </Badge>
  );
}
