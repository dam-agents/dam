import { Badge } from "@/components/ui/badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

import type { AgentView } from "../../../types.js";
import {
  onboardingBadge,
  parseStarterKitRef,
} from "../../agents/utils/agent-kind.js";
import { useFeatures } from "../../features/api/queries.js";
import { useStarterKits } from "../api/queries.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The kit-purple Onboarding tag on an agent row,
 * for a kit agent that has not yet marked its onboarding complete. Hovering
 * names the kit and says the agent's schedules are held until it finishes.
 * The platform records only pending or done, so there is no checklist and no
 * progress fraction here.
 */
export function OnboardingTag({
  agent,
}: {
  agent: Pick<AgentView, "starterKit" | "starterKitOnboarded">;
}) {
  const badge = onboardingBadge(agent);
  const kitsEnabled = useFeatures().data?.["starter-kits"] ?? false;
  const kits = useStarterKits(kitsEnabled && badge !== null);
  if (!badge) return null;

  const ref = agent.starterKit ? parseStarterKitRef(agent.starterKit) : null;
  const kit = ref
    ? kits.data?.find((k) => k.catalog === ref.catalog && k.id === ref.kit)
    : undefined;
  const kitName = kit?.name ?? ref?.kit ?? "Starter kit";

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
        <p className="text-sm font-semibold text-foreground">{kitName} setup</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          The agent&apos;s onboarding session walks you through this. Its
          schedules are held until it marks onboarding complete.
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
