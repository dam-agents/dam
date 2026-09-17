import { Badge } from "@/components/ui/badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

import type { AgentView } from "../../../types.js";
import { onboardingBadge } from "../../agents/utils/agent-kind.js";
import { useKitName } from "../hooks/use-kit-name.js";
import { OnboardingChecklistCard } from "./onboarding-checklist-card.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The kit-purple Onboarding tag on an agent row,
 * for a kit agent that has not yet marked its onboarding complete. Once the
 * agent has set its checklist the tag carries the fraction done, and hovering
 * opens the ticked list; before that it names the kit and says the agent's
 * schedules are held until it finishes.
 */
export function OnboardingTag({
  agent,
}: {
  agent: Pick<
    AgentView,
    "starterKit" | "starterKitOnboarded" | "onboardingSteps"
  >;
}) {
  const badge = onboardingBadge(agent);
  const kitName = useKitName(agent.starterKit, badge !== null);
  if (!badge) return null;

  return (
    <HoverCard openDelay={150} closeDelay={200}>
      <HoverCardTrigger asChild>
        <Badge
          variant={badge.variant}
          className="shrink-0 cursor-default"
          data-testid="agent-onboarding-badge"
        >
          {badge.label}
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="start" className="w-72">
        <OnboardingChecklistCard
          title={`${kitName} setup`}
          steps={agent.onboardingSteps}
        />
      </HoverCardContent>
    </HoverCard>
  );
}
