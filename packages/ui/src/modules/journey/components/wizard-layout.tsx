import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { View } from "../../platform/lib/routes.js";
import { IconRail } from "./icon-rail.js";

export interface WizardStepDef {
  /** The route view this nav entry maps to. "harness" is the landing. */
  view: View;
  label: string;
}

/** The four-step creation journey, in order. Harness selection happens on the
 *  landing; the remaining three are routed wizard steps. */
export const WIZARD_STEPS: readonly WizardStepDef[] = [
  { view: "new-image", label: "Image" },
  { view: "new-sandbox", label: "Configure" },
  { view: "new-connections", label: "Connections" },
  { view: "new-context", label: "Context" },
];

/**
 * Shell for a wizard step: left icon rail, a vertical step-nav column, and the
 * step content with a "STEP N OF M" eyebrow + title. Earlier steps are
 * clickable; later ones are disabled until reached.
 */
export function WizardLayout({
  current,
  title,
  subtitle,
  onStepClick,
  children,
  footer,
}: {
  current: View;
  title: string;
  subtitle?: string;
  /** Navigate to an earlier step. Disabled steps don't call this. */
  onStepClick: (view: View) => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const currentIndex = WIZARD_STEPS.findIndex((s) => s.view === current);

  return (
    <div className="flex h-dvh bg-background">
      <IconRail />
      <div className="flex flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[960px] gap-12 px-6 py-10 md:py-14">
          <StepNav currentIndex={currentIndex} onStepClick={onStepClick} />
          <div className="min-w-0 flex-1 max-w-[640px]">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Step {currentIndex + 1} of {WIZARD_STEPS.length}
            </div>
            <h1 className="mt-1 text-[28px] font-bold tracking-[-0.01em] text-foreground">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1.5 text-[14px] text-muted-foreground">
                {subtitle}
              </p>
            )}
            <div className="mt-8 flex flex-col gap-6">{children}</div>
            {footer && (
              <div className="mt-10 flex items-center justify-end gap-3">
                {footer}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepNav({
  currentIndex,
  onStepClick,
}: {
  currentIndex: number;
  onStepClick: (view: View) => void;
}) {
  return (
    <nav className="hidden w-[160px] shrink-0 flex-col gap-1 md:flex">
      {WIZARD_STEPS.map((step, i) => {
        const active = i === currentIndex;
        const reachable = i <= currentIndex;
        return (
          <button
            key={step.view}
            type="button"
            disabled={!reachable}
            onClick={() => onStepClick(step.view)}
            className={cn(
              "rounded-lg px-3 py-2 text-left text-[15px] transition-colors",
              active
                ? "bg-muted font-semibold text-foreground"
                : reachable
                  ? "text-foreground/80 hover:bg-muted hover:text-foreground"
                  : "cursor-default text-muted-foreground/50",
            )}
          >
            {step.label}
          </button>
        );
      })}
    </nav>
  );
}
