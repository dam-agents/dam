import {
  AlertCircle,
  ArrowLeft,
  Loader2,
  Moon,
  Play,
  RefreshCw,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { StatusBadge } from "../../../components/status-indicator.js";
import type { AgentView } from "../../../types.js";
import { useRestartAgent } from "../hooks/use-restart-agent.js";
import { useWakeAgent } from "../hooks/use-wake-agent.js";
import type {
  AgentDisplay,
  AgentDisplayState,
} from "../utils/agent-resolver.js";

interface OverlayCopy {
  Icon: typeof Loader2;
  description: string;
  spinning: boolean;
}

/** Copy + iconography per non-running state. `running` is present only to
 *  satisfy the exhaustive record; the overlay is never rendered for it. The
 *  `error` description is replaced at render time with the agent's own message. */
const OVERLAY_COPY: Record<AgentDisplayState, OverlayCopy> = {
  running: { Icon: Loader2, description: "", spinning: false },
  starting: {
    Icon: Loader2,
    description: "The agent pod is starting up.",
    spinning: true,
  },
  preparing_workspace: {
    Icon: Loader2,
    description: "Cloning the workspace seed. This finishes shortly.",
    spinning: true,
  },
  hibernating: {
    Icon: Loader2,
    description: "The agent is going to sleep.",
    spinning: true,
  },
  hibernated: {
    Icon: Moon,
    description:
      "The agent went to sleep after a period of inactivity. Start it to pick up where you left off.",
    spinning: false,
  },
  error: {
    Icon: AlertCircle,
    description: "The agent hit an error and isn't running.",
    spinning: false,
  },
};

/** Shared chrome for every overlay variant: full-view takeover, back button,
 *  centered content column. */
function OverlayFrame({
  onBack,
  children,
}: {
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-bg/95 backdrop-blur-sm">
      <button
        onClick={onBack}
        className="absolute left-4 top-3 flex items-center gap-1 text-[13px] font-medium text-text-secondary hover:text-accent transition-colors"
      >
        <ArrowLeft size={14} />
        Sandboxes
      </button>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        {children}
      </div>
    </div>
  );
}

/**
 * Full-view takeover shown whenever the open agent isn't confirmed `running`.
 * Gates the chat/terminal beneath it and surfaces the lifecycle state, plus an
 * explicit Start (hibernated) or Restart (error) — waking is never automatic.
 * A null `display` means the agents list hasn't loaded yet (cold reload): show
 * a neutral spinner so we never flash the chat before the state is known.
 */
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
        <Loader2 size={40} className="text-text-muted animate-spin" />
        <h2 className="text-[18px] font-bold text-text">{name}</h2>
        <p className="max-w-105 text-[14px] text-text-secondary">
          Loading agent…
        </p>
      </OverlayFrame>
    );
  }

  // Shown while displayState is `running` only because the breaker is open: the
  // pod is unreachable but the lifecycle poll hasn't caught up to the dip yet.
  if (display.state === "running") {
    return (
      <OverlayFrame onBack={onBack}>
        <Loader2 size={40} className="text-text-muted animate-spin" />
        <div className="flex flex-col items-center gap-2">
          <h2 className="text-[18px] font-bold text-text">{agent.name}</h2>
          <StatusBadge
            label="Reconnecting"
            colorClasses="bg-warning-light text-warning border-warning"
          />
        </div>
        <p className="max-w-105 text-[14px] text-text-secondary">
          Lost contact with the agent. Reconnecting…
        </p>
      </OverlayFrame>
    );
  }

  const { state, powerAction } = display;
  const { Icon, spinning } = OVERLAY_COPY[state];
  const description =
    state === "error" && agent.error
      ? agent.error
      : OVERLAY_COPY[state].description;

  return (
    <OverlayFrame onBack={onBack}>
      <Icon
        size={40}
        className={`text-text-muted ${spinning ? "animate-spin" : ""}`}
      />
      <div className="flex flex-col items-center gap-2">
        <h2 className="text-[18px] font-bold text-text">{agent.name}</h2>
        <StatusBadge state={state} />
      </div>
      <p className="max-w-105 text-[14px] text-text-secondary">{description}</p>
      {agent.podTerminationReason && (
        <p className="flex items-center gap-1.5 max-w-105 font-mono text-[13px] text-danger">
          <AlertCircle size={14} className="shrink-0" />
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
          <RefreshCw size={14} /> Restart agent
        </Button>
      )}
    </OverlayFrame>
  );
}
