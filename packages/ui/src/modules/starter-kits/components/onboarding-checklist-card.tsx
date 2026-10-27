import { Checkmark, CircleDash } from "@carbon/icons-react";

import type { OnboardingStep } from "../../../types.js";

export function OnboardingChecklistCard({
  title,
  steps,
  onDismiss,
}: {
  title: string;
  steps: readonly OnboardingStep[] | undefined;
  onDismiss?: () => void;
}) {
  const listed = steps ?? [];
  return (
    <>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {listed.length > 0
          ? "Complete these tasks to get your agent running."
          : "The agent's onboarding session walks you through this. Any schedules on it are held until it marks onboarding complete."}
      </p>
      {listed.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {listed.map((step) => (
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
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="mt-3 text-sm text-muted-foreground/60 transition-colors hover:text-muted-foreground"
        >
          Dismiss
        </button>
      )}
    </>
  );
}
