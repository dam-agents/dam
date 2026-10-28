import {
  Add,
  ChevronLeft,
  ChevronRight,
  ColorPalette,
  Document,
  ListBoxes,
  Renew,
  TextFont,
  Warning,
} from "@carbon/icons-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { fireApprovalToast } from "../modules/notifications/hooks/use-approval-toasts.js";
import { useStore } from "../store.js";
import { DevToolsToggle } from "./dev-tools-toggle.js";

const TOAST_AGENTS = [
  "CI Pipeline Agent",
  "Code Review Agent",
  "Security Scanner",
  "Build Agent",
  "Docs Sync Agent",
];

const IN_FRAME = window.self !== window.top;

export function MockStateBar() {
  if (IN_FRAME) return null;
  return <MockStateBarPanel />;
}

function StepControls() {
  const step = useStore((s) => s.onboardingStep);
  const steps = useStore((s) => s.currentTranscriptSteps);
  const setStep = useStore((s) => s.setOnboardingStep);
  const advance = useStore((s) => s.advanceOnboardingStep);
  const [jumpOpen, setJumpOpen] = useState(false);
  const jumpRef = useRef<HTMLDivElement>(null);

  if (steps.length === 0) return null;

  const total = steps.length;
  const display = Math.min(step + 1, total);
  const atStart = step <= 0;
  const atEnd = step >= total;

  return (
    <div className="fixed bottom-4 left-[168px] z-[9999] flex items-center gap-1">
      <button
        type="button"
        disabled={atStart}
        onClick={() => setStep(step - 1)}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted disabled:opacity-40"
        aria-label="Previous step"
      >
        <ChevronLeft size={16} className="text-foreground" />
      </button>

      <span className="flex h-10 min-w-[80px] items-center justify-center rounded-full border border-border bg-card px-3 text-[14px] font-medium text-foreground shadow-lg">
        {atEnd ? "Done" : `${display} / ${total}`}
      </span>

      <button
        type="button"
        disabled={atEnd}
        onClick={advance}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted disabled:opacity-40"
        aria-label="Next step"
      >
        <ChevronRight size={16} className="text-foreground" />
      </button>

      <button
        type="button"
        onClick={() => setStep(0)}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted"
        aria-label="Restart onboarding"
      >
        <Renew size={16} className="text-foreground" />
      </button>

      <div ref={jumpRef} className="relative">
        <button
          type="button"
          onClick={() => setJumpOpen((o) => !o)}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted",
            jumpOpen && "bg-muted",
          )}
          aria-label="Jump to step"
        >
          <ListBoxes size={16} className="text-foreground" />
        </button>
        {jumpOpen && (
          <div className="absolute bottom-12 left-0 z-[10000] w-64 rounded-lg border border-border bg-card p-1 shadow-xl">
            {steps.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setStep(i);
                  setJumpOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[14px] transition-colors hover:bg-muted",
                  i === step && "bg-muted font-medium",
                )}
              >
                <span className="shrink-0 text-muted-foreground">{i + 1}.</span>
                <span className="min-w-0 truncate">{s.label}</span>
                <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">
                  {s.kind}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MockStateBarPanel() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const openApprovals = useStore((s) => s.openApprovals);
  return (
    <>
      <button
        type="button"
        onClick={() => setView("placeholder-texts")}
        className={cn(
          "fixed bottom-4 left-[72px] z-[9999] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted",
          view === "placeholder-texts" && "bg-muted",
        )}
        aria-label="Placeholder texts"
      >
        <TextFont size={16} className="text-foreground" />
      </button>

      <button
        type="button"
        onClick={() => {
          const name =
            TOAST_AGENTS[Math.floor(Math.random() * TOAST_AGENTS.length)]!;
          const headlines = [
            "Wants to access network",
            "Wants to run a command",
          ];
          const headline =
            headlines[Math.floor(Math.random() * headlines.length)]!;
          fireApprovalToast(name, headline, openApprovals);
        }}
        className="fixed bottom-4 left-[120px] z-[9999] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted"
        aria-label="Fire approval toast"
      >
        <Warning size={16} className="text-foreground" />
      </button>

      <StepControls />
      <DevToolsToggle />

      <button
        type="button"
        onClick={() => {
          if (view === "work-card-designs") {
            useStore.setState({ view: "chat" });
          } else {
            setView("work-card-designs");
          }
        }}
        className={cn(
          "fixed bottom-4 right-[60px] z-[9999] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted",
          view === "work-card-designs" && "bg-muted",
        )}
        aria-label="Work card designs"
      >
        <ColorPalette size={16} className="text-foreground" />
      </button>

      <button
        type="button"
        onClick={() => {
          if (view === "add-action-designs") {
            useStore.setState({ view: "chat" });
          } else {
            setView("add-action-designs");
          }
        }}
        className={cn(
          "fixed bottom-4 right-[116px] z-[9999] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted",
          view === "add-action-designs" && "bg-muted",
        )}
        aria-label="Add action designs"
      >
        <Add size={16} className="text-foreground" />
      </button>

      <button
        type="button"
        onClick={() => {
          if (view === "handoff-sheet") {
            useStore.setState({ view: "chat" });
          } else {
            setView("handoff-sheet");
          }
        }}
        className={cn(
          "fixed bottom-4 right-4 z-[9999] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted",
          view === "handoff-sheet" && "bg-muted",
        )}
        aria-label="Handoff sheet"
      >
        <Document size={16} className="text-foreground" />
      </button>
    </>
  );
}
