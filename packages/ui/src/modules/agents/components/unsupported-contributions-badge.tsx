import { Badge } from "@/components/ui/badge";

import type { AgentView } from "../../../types.js";
import { contributionKindList } from "../lib/contribution-kind-labels.js";

export function UnsupportedContributionsBadge({
  kinds,
}: {
  kinds: AgentView["unsupportedContributionKinds"];
}) {
  if (kinds.length === 0) return null;
  return (
    <Badge
      variant="warning"
      title={`This agent's runtime is too old to accept ${contributionKindList(kinds)} it was granted. Update the agent to apply them.`}
    >
      Missing config
    </Badge>
  );
}
