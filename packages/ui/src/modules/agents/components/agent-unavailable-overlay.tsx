import { Asleep, Play, Renew, Warning } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { StatusBadge } from "../../../components/status-indicator.js";
import type { AgentView } from "../../../types.js";
import { useRestartAgent } from "../hooks/use-restart-agent.js";
import { useWakeAgent } from "../hooks/use-wake-agent.js";
import type {
  AgentDisplay,
  AgentDisplayState,
} from "../utils/agent-resolver.js";
import { OverlayFrame } from "./overlay-frame.js";
import { StartupTip } from "./startup-tip.js";

interface OverlayCopy {
  Icon?: typeof Asleep;
  description: string;
}

const OVERLAY_COPY: Record<AgentDisplayState, OverlayCopy> = {
  running: { description: "" },
  running_always_on: { description: "" },
  starting: { description: "The agent pod is starting up." },
  preparing_workspace: {
    description: "Cloning the workspace seed. This finishes shortly.",
  },
  hibernating: { description: "The agent is going to sleep." },
  hibernated: {
    Icon: Asleep,
    description:
      "The agent went to sleep after a period of inactivity. Start it to pick up where you left off.",
  },
  idle_always_on: {
    Icon: Asleep,
    description:
      "The always-on agent is idle. Start it to pick up where you left off.",
  },
  error: {
    Icon: Warning,
    description: "The agent hit an error and isn't running.",
  },
  over_budget: {
    Icon: Warning,
    description:
      "Starting this agent would exceed your compute budget. Pause or stop " +
      "a running agent to free room, then start this one again.",
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
        <h2 className="text-lg font-bold text-foreground">{name}</h2>
        <p className="max-w-105 text-sm text-muted-foreground">
          Loading agent…
        </p>
        <StartupTip sandbox={name} />
      </OverlayFrame>
    );
  }

  if (display.state === "running" || display.state === "running_always_on") {
    return (
      <OverlayFrame onBack={onBack}>
        <Spinner size={40} />
        <div className="flex flex-col items-center gap-2">
          <h2 className="text-lg font-bold text-foreground">{agent.name}</h2>
          <Badge variant="warning">Reconnecting</Badge>
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
  const description =
    state === "error" && agent.error
      ? agent.error
      : OVERLAY_COPY[state].description;

  return (
    <OverlayFrame onBack={onBack}>
      {Icon ? (
        <Icon size={40} className="text-muted-foreground" />
      ) : (
        <Spinner size={40} />
      )}
      <div className="flex flex-col items-center gap-2">
        <h2 className="text-lg font-bold text-foreground">{agent.name}</h2>
        <StatusBadge state={state} />
      </div>
      <p className="max-w-105 text-sm text-muted-foreground">{description}</p>
      {!Icon && <StartupTip sandbox={agent.name} />}
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
