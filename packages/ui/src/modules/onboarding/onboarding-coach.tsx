/**
 * Coaching banner that takes the place of the SetupChecklist when the
 * user has opted in to the guided onboarding flow. Renders inline at the
 * top of /providers, /list (agents), and /connections to coach the user
 * through their first provider, agent, and connection. Auto-clears the
 * onboarding flag when all three are done. Skip dismisses everywhere.
 */
import { ArrowRight, Checkmark, Close as X } from "@carbon/icons-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../../store.js";
import { useAgents } from "../agents/api/queries.js";
import { useAppConnections } from "../connections/api/queries.js";
import { useSecrets } from "../secrets/api/queries.js";
import { setOnboardingActive, useOnboardingActive } from "./onboarding-state.js";

const STEPS = [
  {
    key: "provider" as const,
    view: "providers" as const,
    title: "Add your first provider",
    body: "Pick a provider below and paste in an API key. Your agents need this to reach an AI model — it stays encrypted in the cluster and is never shown to the agent itself.",
    nextHint: "Once you've added a key, head to Agents to spin up your first one.",
    nextView: "list" as const,
    nextLabel: "Go to Agents",
  },
  {
    key: "agent" as const,
    view: "list" as const,
    title: "Create your first agent",
    body: "Click \"Add Agent\" up top. Pick a template (like Claude Code), give it a name, and it'll spin up in the cloud — staying alive between sessions so you can close your laptop and come back later.",
    nextHint: "After your agent is up, swing by Connections to wire in tools like GitHub.",
    nextView: "connections" as const,
    nextLabel: "Go to Connections",
  },
  {
    key: "connection" as const,
    view: "connections" as const,
    title: "Add your first connection",
    body: "Connect a tool your agent should be able to reach — GitHub, Google Workspace, an MCP server, or a custom secret. Credentials are injected into outbound requests at runtime so the agent never sees raw tokens.",
    nextHint: "That's it — you're set up.",
    nextView: null,
    nextLabel: null,
  },
];

export function OnboardingCoach() {
  const active = useOnboardingActive();
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const showToast = useStore((s) => s.showToast);

  const { data: secrets = [], isSuccess: secretsLoaded } = useSecrets();
  const { data: agents = [], isSuccess: agentsLoaded } = useAgents();
  const { data: connections = [], isSuccess: connectionsLoaded } =
    useAppConnections();

  const ready = secretsLoaded && agentsLoaded && connectionsLoaded;
  const hasProvider = secrets.some((s) => s.type === "anthropic");
  const hasAgent = agents.length > 0;
  const hasConnection = connections.length > 0;
  const allDone = hasProvider && hasAgent && hasConnection;

  // Once everything's done, fire a single celebration toast and clear the
  // onboarding flag. Guard on `active` so this only runs the first time
  // the transition happens — re-renders after that won't re-fire.
  useEffect(() => {
    if (active && ready && allDone) {
      showToast({
        kind: "success",
        message: "🎉 All set — your provider, agent, and connection are wired up.",
      });
      setOnboardingActive(false);
    }
  }, [active, ready, allDone, showToast]);

  if (!active) return null;

  // Banner is only relevant on the three onboarding pages.
  const stepIdx = STEPS.findIndex((s) => s.view === view);
  if (stepIdx === -1) return null;
  const step = STEPS[stepIdx]!;

  // Has the user completed *this* page's task? If so, congratulate +
  // surface a "Continue" button to the next view (when there is one).
  const stepDone =
    (step.key === "provider" && hasProvider) ||
    (step.key === "agent" && hasAgent) ||
    (step.key === "connection" && hasConnection);

  return (
    <div
      className={cn(
        "rounded-xl border p-5 mb-8 anim-in",
        stepDone
          ? "border-success/30 bg-success-light"
          : "border-primary/30 bg-primary/5",
      )}
    >
      <div className="flex items-start gap-4">
        <span
          className={cn(
            "h-10 w-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold",
            stepDone
              ? "bg-success text-white"
              : "bg-primary text-primary-foreground",
          )}
          aria-hidden
        >
          {stepDone ? <Checkmark className="h-5 w-5" /> : stepIdx + 1}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-1">
            <span>
              Step {stepIdx + 1} of {STEPS.length}
            </span>
            <span className="opacity-50">·</span>
            <span>{stepDone ? "Complete" : "In progress"}</span>
          </div>
          <h3 className="text-[16px] font-semibold text-foreground mb-1.5">
            {stepDone ? "Nice work." : step.title}
          </h3>
          <p className="text-[13px] text-foreground/80 leading-relaxed">
            {stepDone ? step.nextHint : step.body}
          </p>
          {stepDone && step.nextView && step.nextLabel && (
            <Button
              size="sm"
              className="mt-3"
              onClick={() => setView(step.nextView!)}
            >
              {step.nextLabel} <ArrowRight />
            </Button>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 -mr-1 -mt-1 shrink-0"
          onClick={() => setOnboardingActive(false)}
          aria-label="Skip onboarding"
          title="Skip onboarding"
        >
          <X />
        </Button>
      </div>
    </div>
  );
}
