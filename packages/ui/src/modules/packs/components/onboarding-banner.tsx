import { Checkmark, CircleDash } from "@carbon/icons-react";

import { Callout } from "@/components/ui/callout";

import { useStore } from "../../../store.js";

export function OnboardingBanner({ agentId }: { agentId: string }) {
  const state = useStore((s) => s.onboardingByAgent.get(agentId));
  const dismiss = useStore((s) => s.dismissOnboarding);

  if (!state || state.completed) return null;

  const done = state.steps.filter((s) => s.done).length;

  return (
    <Callout tone="info" size="md">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {state.packName} setup
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {done} of {state.steps.length} steps complete
          </p>
        </div>
        <button
          type="button"
          onClick={() => dismiss(agentId)}
          className="shrink-0 text-sm text-muted-foreground/60 transition-colors hover:text-muted-foreground"
        >
          Dismiss
        </button>
      </div>
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
    </Callout>
  );
}
