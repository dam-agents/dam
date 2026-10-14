import { Asleep, Migrate, Play, Renew, Warning } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { StatusBadge } from "../../../components/status-indicator.js";
import type { AgentView } from "../../../types.js";
import { useRestartAgent } from "../hooks/use-restart-agent.js";
import { useWakeAgent } from "../hooks/use-wake-agent.js";
import { reclaimSentence } from "../lib/reclaim-notices.js";
import { workspaceFailureSentence } from "../lib/workspace-failure.js";
import type {
  AgentDisplay,
  AgentDisplayState,
} from "../utils/agent-resolver.js";
import { AgentAvatar } from "./avatar/agent-avatar.js";
import { OverlayFrame } from "./overlay-frame.js";
import { StartupTip } from "./startup-tip.js";
import { VmRuntimeBadge } from "./vm-runtime-badge.js";

interface OverlayCopy {
  Icon?: typeof Asleep;
  description: string;
}

const VM_MEMORY_FULL =
  "Your VM agents' memory is full. It starts once room frees up — or pause an agent you aren't using.";
const OVERLAY_COPY: Record<AgentDisplayState, OverlayCopy> = {
  running: { description: "" },
  starting: { description: "" },
  preparing_workspace: {
    description: "Setting up the workspace. This finishes shortly.",
  },
  hibernating: { description: "The agent is going to sleep." },
  hibernated: {
    Icon: Asleep,
    description:
      "The agent is paused after a period of inactivity. Start it to pick up where you left off.",
  },
  error: {
    Icon: Warning,
    description: "The agent hit an error and isn't running.",
  },
  over_budget: {
    Icon: Warning,
    description:
      "Starting this agent would exceed your compute budget. Pause agents " +
      "you aren't using to free room, then start this one again.",
  },
  migrating: {
    Icon: Migrate,
    description:
      "The agent is moving to the new sandbox runtime. It is back once its " +
      "data has been copied, which takes a few minutes.",
  },
};

export function AgentUnavailableOverlay({
  agent,
  display,
  name,
  onBack,
}: {
  agent: AgentView | null;
  display: AgentDisplay | null;
  name: string;
  onBack: () => void;
}) {
  const { wake } = useWakeAgent();
  const { restart, isPending: restarting } = useRestartAgent();

  if (!agent || !display) {
    return (
      <OverlayFrame onBack={onBack}>
        <Spinner size={40} />
        <h2 className="text-5xl font-normal tracking-tight text-foreground">
          {name}
        </h2>
        <p className="max-w-105 text-sm text-muted-foreground">
          Loading agent…
        </p>
        <StartupTip sandbox={name} />
      </OverlayFrame>
    );
  }

  if (display.state === "running") {
    return (
      <OverlayFrame onBack={onBack}>
        <Spinner size={40} />
        <div className="flex flex-col items-center gap-4">
          <h2 className="text-5xl font-normal tracking-tight text-foreground">
            {agent.name}
          </h2>
          <div className="flex items-center gap-2">
            <VmRuntimeBadge agent={agent} />
            <Badge variant="warning">Reconnecting</Badge>
          </div>
        </div>
        <p className="max-w-105 text-sm text-muted-foreground">
          Lost contact with the agent. Reconnecting…
        </p>
        <StartupTip sandbox={agent.name} />
      </OverlayFrame>
    );
  }

  const { state, powerAction } = display;
  const { Icon } = OVERLAY_COPY[state];
  const description = overlayDescription(state, agent);
  const waiting = state === "starting" || state === "preparing_workspace";

  return (
    <OverlayFrame onBack={onBack}>
      {waiting ? (
        <AgentAvatar
          name={agent.name}
          avatar={agent.avatar}
          size={128}
          playing
        />
      ) : Icon ? (
        <Icon size={40} className="text-muted-foreground" />
      ) : (
        <Spinner size={40} />
      )}
      <div className="flex flex-col items-center gap-4">
        <h2 className="text-5xl font-normal tracking-tight text-foreground">
          {agent.name}
        </h2>
        <div className="flex items-center gap-2 empty:hidden">
          <VmRuntimeBadge agent={agent} />
          {state !== "starting" && <StatusBadge state={state} vm={agent.vm} />}
        </div>
      </div>
      {description && (
        <p className="max-w-105 text-sm text-muted-foreground">{description}</p>
      )}
      {state === "starting" && (
        <p role="status" className="sr-only">
          The agent is starting up.
        </p>
      )}
      {!Icon && <StartupTip sandbox={agent.name} />}
      {display.slowStart && !agent.podTerminationReason && (
        <div className="flex max-w-105 flex-col gap-2 text-sm">
          <p
            role="status"
            className="flex items-center justify-center gap-1.5 text-warning"
          >
            <Warning size={14} className="shrink-0" />
            Starting is taking longer than usual.
          </p>
          {agent.notReadyMessage && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-left font-mono text-xs text-muted-foreground">
              {agent.notReadyMessage}
            </pre>
          )}
        </div>
      )}
      {agent.podTerminationReason && (
        <p className="flex items-center gap-1.5 max-w-105 font-mono text-sm text-danger">
          <Warning size={14} className="shrink-0" />
          {agent.podTerminationReason}
        </p>
      )}
      {powerAction === "start" && (
        <Button onClick={() => wake(agent.id)}>
          <Play size={14} /> Start agent
        </Button>
      )}
      {powerAction === "restart" && (
        <Button onClick={() => restart(agent.id)} disabled={restarting}>
          <Renew size={14} /> Restart agent
        </Button>
      )}
    </OverlayFrame>
  );
}

function overlayDescription(
  state: AgentDisplayState,
  agent: AgentView,
): string {
  if (state === "error" && agent.error) return agent.error;
  const budget = agent.overBudgetMessage;
  if (state === "over_budget" && budget)
    return `${budget[0].toUpperCase()}${budget.slice(1)}${budget.endsWith(".") ? "" : "."}`;
  if (state === "over_budget" && agent.vm) return VM_MEMORY_FULL;
  const reclaimed = reclaimSentence(agent);
  if (state === "hibernated" && reclaimed) return reclaimed;
  if (state === "preparing_workspace") {
    const failing = agent.workspaceFailures.find((f) => !f.settled);
    if (failing) return workspaceFailureSentence(failing);
  }
  return OVERLAY_COPY[state].description;
}
