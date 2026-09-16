import { CircleDash } from "@carbon/icons-react";

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
 * UNIT_BOUNDARY_DESCRIPTION: The purple Onboarding tag on an agent row, for a
 * kit agent that has not yet marked its onboarding complete. Hovering lists
 * what the kit's onboarding will ask for — the kit's declared parameters — and
 * says that the agent's schedules are held until it finishes. The platform
 * knows only that onboarding is pending or done, not which step it is on, so
 * the list is what will be asked, not a progress meter.
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
  const parameters = kit?.parameters ?? [];

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
          The agent&apos;s first session walks you through this. Its schedules
          are held until it marks onboarding complete.
        </p>
        {parameters.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {parameters.map((p) => (
              <li key={p.name} className="flex items-start gap-2">
                <CircleDash
                  size={16}
                  className="mt-0.5 shrink-0 text-muted-foreground/50"
                />
                <span className="text-sm text-foreground">
                  {p.name}
                  {!p.required && (
                    <span className="text-muted-foreground"> (optional)</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
