import { ArrowRight, CalendarClock, Check, Cloud, ShieldCheck, Users, X } from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";

import tourPlaceholder from "@/assets/Walkthrough-Gradiant.png";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useAgents } from "../agents/api/queries.js";
import { useSecrets } from "../secrets/api/queries.js";
import { useStore } from "../../store.js";

const DISMISS_KEY = "platform-welcome-tour-dismissed";
// Mock mode: designer iterating → reset on reload.
const PERSIST_DISMISS = import.meta.env.VITE_USE_MOCKS !== "true";

type TourStep = {
  key: "welcome" | "provider" | "agent" | "connections";
  title: string;
  body: string;
  /** CSS selector for the DOM element the tooltip anchors to. Absent for
   *  the welcome step, which renders as a modal instead of a tooltip. */
  anchorSelector?: string;
  /** View to switch to when this step is entered. */
  view?: "list" | "providers" | "connections";
  optional?: boolean;
};

const STEPS: TourStep[] = [
  {
    key: "welcome",
    title: "Welcome to DAM",
    body:
      "Run agent harnesses like Claude Code headless in the cloud, on a schedule, connected to your tools — without exposing your tokens.",
  },
  {
    key: "provider",
    title: "Set up a provider",
    body:
      "Providers let your agents reach an AI model. Connect Anthropic and you're ready to run Claude-based agents.",
    anchorSelector: "#tour-anthropic-card",
    view: "providers",
  },
  {
    key: "agent",
    title: "Create an agent",
    body:
      "Pick a template (like Claude Code) and name your agent. It'll spin up in the cloud and stay alive between sessions.",
    anchorSelector: "#tour-add-agent",
    view: "list",
  },
  {
    key: "connections",
    title: "Add connections",
    body:
      "Give agents access to GitHub, Google Workspace, or other OAuth apps. You can always add more connections later.",
    anchorSelector: "#tour-connections-header",
    view: "connections",
  },
];

const FEATURES: {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}[] = [
  { icon: Cloud, text: "Close your laptop. Your agent keeps running in the cloud." },
  { icon: ShieldCheck, text: "Credentials stay hidden — even from the agent." },
  { icon: Users, text: "Collaborate securely with individual credentials." },
  { icon: CalendarClock, text: "Define a schedule once; execution runs automatically." },
];

/**
 * Guided-tour variation of the setup flow. The first step is a proper
 * welcome modal with a "Why DAM?" pitch; subsequent steps are floating
 * tooltips anchored to sidebar nav items. Each Next click advances and
 * routes the user to the relevant page. Hides entirely once the user has
 * both a provider and at least one agent.
 */
export function WelcomeTour() {
  const { data: agents = [], isSuccess: agentsLoaded } = useAgents();
  const { data: secrets = [], isSuccess: secretsLoaded } = useSecrets();
  const setView = useStore((s) => s.setView);

  const [stepIdx, setStepIdx] = useState(0);
  const [dismissed, setDismissed] = useState(
    () => PERSIST_DISMISS && localStorage.getItem(DISMISS_KEY) === "true",
  );

  const ready = agentsLoaded && secretsLoaded;
  const hasProvider = secrets.some((s) => s.type === "anthropic");
  const hasAgent = agents.length > 0;
  const shouldShow = ready && !dismissed && (!hasProvider || !hasAgent);
  const step = STEPS[stepIdx];
  const isWelcomeStep = step.key === "welcome";

  // Navigate to the step's view when it changes so the anchored sidebar
  // nav item lights up and the relevant page sits behind the tooltip.
  useEffect(() => {
    if (shouldShow && step.view) setView(step.view);
  }, [shouldShow, step.view, setView]);

  const dismiss = () => {
    if (PERSIST_DISMISS) localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  };

  const goBack = () => setStepIdx((i) => Math.max(0, i - 1));
  const goNext = () => {
    if (stepIdx < STEPS.length - 1) setStepIdx((i) => i + 1);
    else dismiss();
  };

  if (!shouldShow) return null;

  if (isWelcomeStep) {
    return (
      <Dialog open onOpenChange={(open) => !open && dismiss()}>
        <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
          {/* Hero band — tinted gradient, small eyebrow, big title */}
          <div className="relative px-8 pt-8 pb-7 bg-gradient-to-br from-primary/8 via-primary/3 to-transparent border-b">
            <span className="inline-block text-[10px] font-bold uppercase tracking-[0.12em] text-primary/80 mb-3">
              Deploy Agents Massively
            </span>
            <DialogHeader className="space-y-3 items-start text-left">
              <DialogTitle className="text-3xl font-semibold tracking-tight leading-[1.1]">
                Welcome to DAM
              </DialogTitle>
              <DialogDescription className="text-[15px] leading-relaxed max-w-lg">
                Run agent harnesses like Claude Code headless in the cloud, on
                a schedule, connected to your tools — without exposing your
                tokens.
              </DialogDescription>
            </DialogHeader>
          </div>

          {/* Features — 2×2 grid with subtle surface tint */}
          <div className="px-8 py-6">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-4">
              Why DAM?
            </div>
            <ul className="grid sm:grid-cols-2 gap-x-5 gap-y-5">
              {FEATURES.map((f) => (
                <li key={f.text} className="flex gap-4 items-start">
                  <span className="h-12 w-12 rounded-xl bg-info-light text-info flex items-center justify-center shrink-0">
                    <f.icon className="h-6 w-6" />
                  </span>
                  <span className="text-[13.5px] leading-snug pt-2.5">{f.text}</span>
                </li>
              ))}
            </ul>
          </div>

          <DialogFooter className="gap-2 sm:gap-2 px-8 pb-8 pt-2">
            <Button variant="outline" onClick={dismiss}>
              Explore on my own
            </Button>
            <Button onClick={goNext}>
              Take a quick tour <ArrowRight />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Non-welcome steps: anchored tooltip
  const tourStepIdx = stepIdx - 1;
  const totalTourSteps = STEPS.length - 1;
  const isLast = stepIdx === STEPS.length - 1;

  return (
    <>
      {/* Subtle backdrop — dims the app without blocking clicks so the user
          can still see and interact with the page behind the tour. */}
      <div className="fixed inset-0 z-[140] bg-black/20 pointer-events-none" />

      <AnchoredTooltip
        key={step.key}
        selector={step.anchorSelector!}
        step={step}
        stepIdx={tourStepIdx}
        totalSteps={totalTourSteps}
        isLast={isLast}
        onBack={goBack}
        onNext={goNext}
        onDismiss={dismiss}
      />
    </>
  );
}

interface ContentProps {
  step: TourStep;
  stepIdx: number;
  totalSteps: number;
  isLast: boolean;
  onBack: () => void;
  onNext: () => void;
  onDismiss: () => void;
}

function TooltipContent({
  step,
  stepIdx,
  totalSteps,
  isLast,
  onBack,
  onNext,
  onDismiss,
}: ContentProps) {
  return (
    <div className="w-[340px] relative rounded-lg border bg-popover text-popover-foreground shadow-xl overflow-hidden">
      {/* Image slot — 16:9 at the top of each tooltip. Swap the src per
          step when step-specific visuals are added (key on step.key). */}
      <img
        src={tourPlaceholder}
        alt=""
        className="block w-full aspect-[16/9] object-cover"
      />

      {/* Close — absolute top-right, floats over the image */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-1.5 right-1.5 h-6 w-6 bg-popover/80 hover:bg-popover backdrop-blur-sm"
        onClick={onDismiss}
        aria-label="Skip tour"
      >
        <X />
      </Button>

      <div className="p-4 space-y-3">
      <div>
        <div className="flex items-center gap-2 mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>
            {stepIdx + 1} of {totalSteps}
          </span>
          {step.optional && (
            <>
              <span className="opacity-40">·</span>
              <span>Optional</span>
            </>
          )}
        </div>
        <h3 className="text-sm font-semibold">{step.title}</h3>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{step.body}</p>
      <div className="flex items-center gap-2 pt-1">
        {stepIdx > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="h-7 px-2 text-xs"
          >
            Back
          </Button>
        )}
        <div className="flex-1" />
        <Button size="sm" onClick={onNext} className="h-7 text-xs">
          {isLast ? "Finish" : "Next"} {isLast ? <Check /> : <ArrowRight />}
        </Button>
      </div>
      </div>
    </div>
  );
}

function AnchoredTooltip({
  selector,
  ...props
}: ContentProps & { selector: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const el = document.querySelector(selector);
      if (el) setRect(el.getBoundingClientRect());
      else setRect(null);
    };
    update();
    // Re-measure on resize so the tooltip tracks its anchor.
    window.addEventListener("resize", update);
    // Small interval in case the anchor mounts slightly later than the tour.
    const interval = window.setInterval(update, 500);
    return () => {
      window.removeEventListener("resize", update);
      window.clearInterval(interval);
    };
  }, [selector]);

  if (!rect) {
    // Anchor not found yet — fall back to centered so the step isn't lost.
    return (
      <div className="fixed inset-0 z-[150] flex items-center justify-center px-4 pointer-events-none">
        <div className="pointer-events-auto">
          <TooltipContent {...props} />
        </div>
      </div>
    );
  }

  const GAP = 12;
  const TOOLTIP_W = 340;
  const topRaw = rect.top + rect.height / 2 - 80;
  const top = Math.max(16, Math.min(window.innerHeight - 240, topRaw));
  const left = Math.min(window.innerWidth - TOOLTIP_W - 16, rect.right + GAP);

  return (
    <div className="fixed z-[150] pointer-events-auto" style={{ top, left }}>
      <div
        className="absolute w-3 h-3 rotate-45 bg-popover border-l border-b"
        style={{ left: -6, top: Math.min(80, rect.top + rect.height / 2 - top - 6) }}
      />
      <TooltipContent {...props} />
    </div>
  );
}
