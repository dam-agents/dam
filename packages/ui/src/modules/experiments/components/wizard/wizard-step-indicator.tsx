import { cn } from "@/lib/utils";

const STEPS = ["Setup", "Arms", "Review"] as const;

interface Props {
  step: number;
  maxStep: number;
  onNavigate: (step: number) => void;
}

export function WizardStepIndicator({ step, maxStep, onNavigate }: Props) {
  return (
    <nav
      aria-label="Wizard steps"
      className="flex shrink-0 flex-row gap-1 md:w-[200px] md:flex-col"
    >
      {STEPS.map((label, index) => {
        const state =
          index === step ? "active" : index <= maxStep ? "visited" : "upcoming";
        return (
          <button
            key={label}
            type="button"
            disabled={state === "upcoming"}
            onClick={() => onNavigate(index)}
            aria-current={state === "active" ? "step" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-[15px] transition-colors",
              state === "active" && "bg-muted font-medium text-foreground",
              state === "visited" && "text-foreground hover:bg-muted/60",
              state === "upcoming" && "cursor-default text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full text-[12px] font-medium",
                index <= maxStep
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground",
              )}
            >
              {index + 1}
            </span>
            {label}
          </button>
        );
      })}
    </nav>
  );
}
