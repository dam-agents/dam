import { cn } from "@/lib/utils";

import type { WizardStep } from "../lib/wizard-snapshot.js";

const STEPS = [
  { n: 1, label: "Image" },
  { n: 2, label: "Setup" },
  { n: 3, label: "Connections" },
] as const;

interface Props {
  step: WizardStep;
  /** Annotation appended to the Image step once an image is chosen, e.g. "(Claude Code)". */
  imageLabel: string | null;
  onNavigate: (step: WizardStep) => void;
}

/**
 * Persistent step indicator: a vertical list on desktop, a compact horizontal
 * row on narrow viewports. Already-visited steps are clickable to go back;
 * upcoming steps are inert.
 */
export function WizardStepIndicator({ step, imageLabel, onNavigate }: Props) {
  return (
    <nav
      aria-label="Wizard steps"
      className="flex shrink-0 flex-row gap-1 md:w-[200px] md:flex-col"
    >
      {STEPS.map((item) => (
        <StepItem
          key={item.n}
          label={item.label}
          annotation={item.n === 1 ? imageLabel : null}
          state={
            item.n === step ? "active" : item.n < step ? "visited" : "upcoming"
          }
          onClick={() => onNavigate(item.n as WizardStep)}
        />
      ))}
    </nav>
  );
}

function StepItem({
  label,
  annotation,
  state,
  onClick,
}: {
  label: string;
  annotation: string | null;
  state: "active" | "visited" | "upcoming";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={state === "upcoming"}
      onClick={onClick}
      aria-current={state === "active" ? "step" : undefined}
      className={cn(
        "rounded-md px-3 py-2 text-left text-[15px] transition-colors",
        state === "active" && "bg-muted font-medium text-foreground",
        state === "visited" && "text-foreground hover:bg-muted/60",
        // Upcoming steps use the lighter brand muted-text token (Cool Gray 40),
        // not shadcn's darker `muted-foreground`, to match the design.
        state === "upcoming" && "cursor-default text-text-muted",
      )}
    >
      {label}
      {annotation && (
        <span className="ml-1 hidden font-normal text-text-muted md:inline">
          ({annotation})
        </span>
      )}
    </button>
  );
}
