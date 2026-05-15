import {
  ArrowRight,
  Checkmark as Check,
  Close as X,
  Cloud,
  EventSchedule,
  Group,
  Security,
} from "@carbon/icons-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { useStore } from "../../store.js";
import { useAgents } from "../agents/api/queries.js";
import { useAppConnections } from "../connections/api/queries.js";
import type { View } from "../platform/lib/routes.js";
import { useSecrets } from "../secrets/api/queries.js";

const DISMISS_KEY = "platform-welcome-tour-dismissed";
// Mock mode: designer iterating → reset on reload.
const PERSIST_DISMISS = import.meta.env.VITE_USE_MOCKS !== "true";

const FEATURES: {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}[] = [
  { icon: Cloud, text: "Close your laptop. Your agent keeps running in the cloud." },
  { icon: Security, text: "Credentials stay hidden — even from the agent." },
  { icon: Group, text: "Collaborate securely with individual credentials." },
  { icon: EventSchedule, text: "Define a schedule once; execution runs automatically." },
];

/**
 * First-run onboarding. A welcome modal introduces the product, then a
 * persistent checklist card replaces it and walks the user through the
 * remaining setup steps. Same component on desktop and mobile — the card
 * docks bottom-right on wide viewports and stretches full-width at the
 * bottom on narrow ones. Hides entirely once the user has both a provider
 * and at least one agent.
 */
export function WelcomeTour() {
  const { data: agents = [], isSuccess: agentsLoaded } = useAgents();
  const { data: secrets = [], isSuccess: secretsLoaded } = useSecrets();
  const { data: connections = [], isSuccess: connectionsLoaded } =
    useAppConnections();
  const [welcomeSeen, setWelcomeSeen] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => PERSIST_DISMISS && localStorage.getItem(DISMISS_KEY) === "true",
  );

  const ready = agentsLoaded && secretsLoaded && connectionsLoaded;
  const hasProvider = secrets.some((s) => s.type === "anthropic");
  const hasAgent = agents.length > 0;
  const hasConnection = connections.length > 0;
  const allDone = hasProvider && hasAgent && hasConnection;

  // Track whether the user has actually been on the journey this session.
  // Returning users who already have everything set up should NOT see an
  // "All set" celebration — only users who watched the steps tick off do.
  const [everSeenIncomplete, setEverSeenIncomplete] = useState(false);
  useEffect(() => {
    if (ready && !allDone) setEverSeenIncomplete(true);
  }, [ready, allDone]);

  const shouldShow = ready && !dismissed && (!allDone || everSeenIncomplete);

  const dismiss = () => {
    if (PERSIST_DISMISS) localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  };

  if (!shouldShow) return null;

  if (!welcomeSeen) {
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
            <Button onClick={() => setWelcomeSeen(true)}>
              Get started <ArrowRight />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <SetupChecklist
      hasProvider={hasProvider}
      hasAgent={hasAgent}
      hasConnection={hasConnection}
      allDone={allDone}
      onDismiss={dismiss}
    />
  );
}

interface SetupChecklistProps {
  hasProvider: boolean;
  hasAgent: boolean;
  hasConnection: boolean;
  allDone: boolean;
  onDismiss: () => void;
}

export function SetupChecklist({
  hasProvider,
  hasAgent,
  hasConnection,
  allDone,
  onDismiss,
}: SetupChecklistProps) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const items: {
    key: string;
    label: string;
    description: string;
    done: boolean;
    view: View;
  }[] = [
    {
      key: "provider",
      label: "Add a provider",
      description: "Connect Anthropic so agents can reach a model.",
      done: hasProvider,
      view: "providers",
    },
    {
      key: "agent",
      label: "Create an agent",
      description: "Spin up Claude Code or another harness.",
      done: hasAgent,
      view: "list",
    },
    {
      key: "connections",
      label: "Add a connection",
      description: "Wire up GitHub, Google Workspace, or other OAuth apps.",
      done: hasConnection,
      view: "connections",
    },
  ];
  const totalCount = items.length;
  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="fixed z-[150] bottom-[calc(64px+env(safe-area-inset-bottom))] left-4 right-4 md:left-auto md:right-6 md:bottom-6 md:w-[380px] rounded-xl border bg-popover text-popover-foreground shadow-xl overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2 border-b">
        <div className="min-w-0 flex items-start gap-2">
          {allDone ? (
            <span className="text-[18px] leading-none mt-[1px] shrink-0" aria-hidden>
              🎉
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              {allDone ? "All set" : "Get started"}
            </div>
            <div className="text-sm font-semibold">
              {allDone
                ? "Nice work — you're ready to go"
                : `${doneCount} of ${totalCount} complete`}
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 -mr-1 -mt-1 shrink-0"
          onClick={onDismiss}
          aria-label="Dismiss setup checklist"
        >
          <X />
        </Button>
      </div>
      <ul className="p-1.5">
        {items.map((item, idx) => {
          const active = view === item.view;
          return (
          <li key={item.key}>
            <button
              type="button"
              onClick={() => setView(item.view)}
              className={cn(
                "w-full flex items-center gap-3 p-2 rounded-lg text-left hover:bg-muted active:bg-muted focus-visible:bg-muted focus-visible:outline-none transition-colors",
                active && "bg-muted",
              )}
            >
              <span
                className={cn(
                  "h-8 w-8 rounded-full flex items-center justify-center shrink-0",
                  item.done
                    ? "bg-success-light text-success"
                    : "bg-info-light text-info",
                )}
              >
                {item.done ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <span className="text-xs font-semibold">{idx + 1}</span>
                )}
              </span>
              <span className="flex-1 min-w-0">
                <span
                  className={cn(
                    "block text-sm font-medium truncate",
                    item.done && "line-through text-muted-foreground",
                  )}
                >
                  {item.label}
                </span>
                <span className="block text-xs text-muted-foreground leading-snug">
                  {item.description}
                </span>
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          </li>
          );
        })}
      </ul>
      {allDone && (
        <div className="px-3 pb-3 pt-1 border-t">
          <Button onClick={onDismiss} className="w-full">
            Got it
          </Button>
        </div>
      )}
    </div>
  );
}
