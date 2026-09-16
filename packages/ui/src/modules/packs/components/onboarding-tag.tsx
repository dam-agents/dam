import { Checkmark, CircleDash } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

import { useStore } from "../../../store.js";

export function OnboardingTag({ agentId }: { agentId: string }) {
  const state = useStore((s) => s.onboardingByAgent.get(agentId));
  const dismiss = useStore((s) => s.dismissOnboarding);

  if (!state || state.completed) return null;

  const done = state.steps.filter((s) => s.done).length;

  return (
    <HoverCard openDelay={150} closeDelay={300}>
      <HoverCardTrigger asChild>
        <Badge variant="preset" className="cursor-default">
          Onboarding {done}/{state.steps.length}
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="start" className="w-64">
        <p className="text-sm font-semibold text-foreground">
          {state.packName} setup
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Complete these steps to finish onboarding.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {state.steps.map((step) => (
            <li key={step.id} className="flex items-center gap-2">
              {step.done ? (
                <Checkmark size={16} className="shrink-0 text-success" />
              ) : (
                <CircleDash
                  size={16}
                  className="shrink-0 text-muted-foreground/50"
                />
              )}
              <span
                className={
                  step.done
                    ? "text-sm text-muted-foreground line-through"
                    : "text-sm text-foreground"
                }
              >
                {step.label}
              </span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => dismiss(agentId)}
          className="mt-3 text-sm text-muted-foreground/60 transition-colors hover:text-muted-foreground"
        >
          Dismiss
        </button>
      </HoverCardContent>
    </HoverCard>
  );
}
