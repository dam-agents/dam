import { ArrowRight, Check } from "lucide-react";
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
 * Setup progress banner. Compact three-step indicator (numbered circles +
 * connector lines) with the current step's label inline and a Next-step
 * CTA. Per-step labels next to each circle are dropped to reduce visual
 * weight. Hides once the user has both a provider and at least one agent.
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
  const onStepPage = currentStepIdx >= 0 && !isDone(STEPS[currentStepIdx].key);
  const firstIncompleteIdx = STEPS.findIndex((s) => !isDone(s.key) && !s.optional);
  const displayedIdx = onStepPage
    ? currentStepIdx
    : firstIncompleteIdx < 0
      ? STEPS.length - 1
      : firstIncompleteIdx;
  const displayedStep = STEPS[displayedIdx];

  const isLastStep = displayedIdx === STEPS.length - 1;
  const nextStep = !isLastStep ? STEPS[displayedIdx + 1] : null;

  const ctaLabel = isLastStep ? "Done" : "Next step";
  const onCta = () => {
    if (isLastStep) setView("list");
    else if (nextStep) setView(nextStep.view);
  };

  return (
    <div className="bg-template-light text-foreground shrink-0">
      <div className="mx-auto w-full max-w-[1200px] px-4 md:px-6 py-3 flex items-center justify-center gap-4 md:gap-5 overflow-x-auto">
        <div className="flex flex-col leading-tight shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            DAM Setup
          </span>
          <span className="text-sm font-semibold text-foreground">
            {displayedStep.label}
            {displayedStep.optional && (
              <span className="text-muted-foreground font-normal"> (optional)</span>
            )}
          </span>
        </div>

        {/* Step indicator — numbered circles, no per-step labels */}
        <div className="flex items-center gap-1.5 shrink-0">
          {STEPS.map((s, i) => {
            const done = isDone(s.key);
            const active = i === displayedIdx && !done;
            const nextDone = i < STEPS.length - 1 && isDone(STEPS[i + 1].key);
            return (
              <Fragment key={s.key}>
                <button
                  type="button"
                  onClick={() => setView(s.view)}
                  aria-label={`Step ${i + 1}: ${s.label}`}
                  className={cn(
                    "h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 transition-colors",
                    active
                      ? "bg-template text-white"
                      : done
                        ? "bg-template/20 text-template"
                        : "border border-border text-muted-foreground hover:border-template hover:text-template",
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                </button>
                {i < STEPS.length - 1 && (
                  <div
                    className={cn(
                      "h-px w-3 md:w-4 shrink-0",
                      done && nextDone ? "bg-template" : done ? "bg-template/60" : "bg-border",
                    )}
                  />
                )}
              </Fragment>
            );
          })}
        </div>

        <Button
          size="sm"
          onClick={onCta}
          className="bg-template text-white hover:bg-template/90 shrink-0 ml-auto md:ml-0"
        >
          {ctaLabel} {isLastStep ? <Check /> : <ArrowRight />}
        </Button>
      </div>
    </div>
  );
}
