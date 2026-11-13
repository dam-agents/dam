import type { AgentView } from "../../../types.js";
import { contributionKindList } from "../lib/contribution-kind-labels.js";
import { AgentOutdatedNotice } from "./agent-outdated-notice.js";

export function ContributionGapNotice({ agent }: { agent: AgentView | null }) {
  const kinds = agent?.unsupportedContributionKinds ?? [];
  if (kinds.length === 0) return null;

  return (
    <AgentOutdatedNotice>
      This agent doesn&rsquo;t accept {contributionKindList(kinds)} it was
      granted yet, so it is running without them.
    </AgentOutdatedNotice>
  );
}
