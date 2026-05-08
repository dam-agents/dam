import { ArrowRight, Check, Sparkles } from "lucide-react";
import { Fragment } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useAgents } from "../agents/api/queries.js";
import { useSecrets } from "../secrets/api/queries.js";
import { useStore } from "../../store.js";

type ViewKey = "providers" | "list" | "connections";

interface Step {
  key: "provider" | "agent" | "connections";
  label: string;
  view: ViewKey;
  optional?: boolean;
}

const STEPS: Step[] = [
  { key: "provider", label: "Set up a provider", view: "providers" },
  { key: "agent", label: "Create an agent", view: "list" },
  { key: "connections", label: "Add connections", view: "connections", optional: true },
];

/**
 * Setup progress banner. Solid surface with a DAM-setup label on the left,
 * a progress stepper in the middle, and a Next-step CTA on the right. Each
 * step navigates to its corresponding page. Hides once the user has both a
 * provider and at least one agent.
 */
export function WelcomeStepper() {
  const { data: agents = [], isSuccess: agentsLoaded } = useAgents();
  const { data: secrets = [], isSuccess: secretsLoaded } = useSecrets();
  const currentView = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);

  const ready = agentsLoaded && secretsLoaded;
  const hasProvider = secrets.some((s) => s.type === "anthropic");
  const hasAgent = agents.length > 0;
  const shouldShow = ready && (!hasProvider || !hasAgent);

  if (!shouldShow) return null;

  const isDone = (k: Step["key"]) =>
    (k === "provider" && hasProvider) || (k === "agent" && hasAgent);

  const currentStepIdx = STEPS.findIndex((s) => s.view === currentView);
  const isOnStep = currentStepIdx >= 0;
  const isLastStep = currentStepIdx === STEPS.length - 1;
  const nextStep = isOnStep && !isLastStep ? STEPS[currentStepIdx + 1] : null;

  const ctaLabel = isLastStep ? "Done" : "Next step";
  const onCta = () => {
    if (isLastStep) setView("list");
    else if (nextStep) setView(nextStep.view);
  };

  return (
    <div className="bg-template text-white border-b border-template shrink-0 shadow-sm">
      <div className="mx-auto w-full max-w-[1200px] px-4 md:px-6 py-3 flex items-center justify-center gap-3 md:gap-4 overflow-x-auto">
        {/* Left: identity label */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="h-7 w-7 rounded-md bg-white/15 border border-white/25 flex items-center justify-center shrink-0">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-white/70">
              DAM Setup
            </span>
            <span className="text-sm font-semibold">Finish setting up</span>
          </div>
        </div>

        <div className="h-8 w-px bg-white/25 shrink-0 hidden md:block" />

        {/* Middle: stepper */}
        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          {STEPS.map((s, i) => {
            const done = isDone(s.key);
            const active = currentView === s.view && !done;
            const nextDone = i < STEPS.length - 1 && isDone(STEPS[i + 1].key);
            return (
              <Fragment key={s.key}>
                <StepItem
                  index={i + 1}
                  label={s.label}
                  optional={s.optional}
                  done={done}
                  active={active}
                  onClick={() => setView(s.view)}
                />
                {i < STEPS.length - 1 && (
                  <div
                    className={cn(
                      "h-px w-3 md:w-5 shrink-0 transition-colors",
                      done && nextDone ? "bg-white" : done ? "bg-white/70" : "bg-white/25",
                    )}
                  />
                )}
              </Fragment>
            );
          })}
        </div>

        {/* Right: next step / done CTA */}
        {isOnStep && (
          <>
            <div className="h-8 w-px bg-white/25 shrink-0 hidden md:block" />
            <Button
              size="sm"
              onClick={onCta}
              className="bg-white text-template hover:bg-white/90 shrink-0"
            >
              {ctaLabel} {isLastStep ? <Check /> : <ArrowRight />}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function StepItem({
  index,
  label,
  optional,
  done,
  active,
  onClick,
}: {
  index: number;
  label: string;
  optional?: boolean;
  done: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-2 shrink-0 rounded-md px-1 py-0.5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white/60"
    >
      <span
        className={cn(
          "h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 transition-colors",
          active
            ? "bg-white text-template"
            : done
              ? "bg-white/25 text-white"
              : "border border-white/50 text-white/80 group-hover:bg-white/15",
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : index}
      </span>
      <span
        className={cn(
          "text-sm transition-colors hidden sm:inline",
          active
            ? "text-white font-semibold"
            : done
              ? "text-white/60 font-medium line-through"
              : "text-white/80 font-medium group-hover:text-white",
        )}
      >
        {label}
        {optional && <span className="text-white/60 font-normal"> (optional)</span>}
      </span>
    </button>
  );
}
