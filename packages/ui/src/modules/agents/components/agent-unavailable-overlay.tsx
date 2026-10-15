import { Asleep, Migrate, Play, Renew, Warning } from "@carbon/icons-react";
import { isStartRefusal } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { StatusBadge } from "../../../components/status-indicator.js";
import type { AgentView } from "../../../types.js";
import { useRestartAgent } from "../hooks/use-restart-agent.js";
import { useWakeAgent } from "../hooks/use-wake-agent.js";
import { overlayDescription } from "../lib/overlay-copy.js";
import type {
  AgentDisplay,
  AgentDisplayState,
} from "../utils/agent-resolver.js";
import { AgentAvatar } from "./avatar/agent-avatar.js";
import { OverlayFrame } from "./overlay-frame.js";
import { StartupTip } from "./startup-tip.js";
import { TerminationReason } from "./termination-reason.js";
import { VmRuntimeBadge } from "./vm-runtime-badge.js";

const OVERLAY_ICON: Partial<Record<AgentDisplayState, typeof Asleep>> = {
  hibernated: Asleep,
  disabled: Asleep,
  error: Warning,
  over_budget: Warning,
  migrating: Migrate,
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
  const Icon = OVERLAY_ICON[state];
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
          {state !== "starting" && (
            <StatusBadge
              state={state}
              vm={agent.vm}
              refused={isStartRefusal(agent.podTerminationCode)}
            />
          )}
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
      <TerminationReason agent={agent} size="sm" />
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
