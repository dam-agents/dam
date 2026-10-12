import { Power, Renew, Warning } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { ChatColumn } from "../../sessions/components/chat-column.js";
import { useUpdateAgent } from "../api/mutations.js";
import { useRestartAgent } from "../hooks/use-restart-agent.js";
import { workspaceFailureSentence } from "../lib/workspace-failure.js";
import type { AgentDisplay } from "../utils/agent-resolver.js";
import { AgentAvatar } from "./avatar/agent-avatar.js";

export function AgentStartingBar({
  agent,
  display,
}: {
  agent: AgentView;
  display: AgentDisplay;
}) {
  const { restart, isPending: restarting } = useRestartAgent();
  const preparing = display.state === "preparing_workspace";
  const slow = display.slowStart && !agent.podTerminationReason;
  const failing = preparing
    ? agent.workspaceFailures.find((f) => !f.settled)
    : undefined;

  return (
    <div className="px-4 md:px-8" data-testid="agent-starting-bar">
      <ChatColumn>
        <div className="mb-3 flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <AgentAvatar
              name={agent.name}
              avatar={agent.avatar}
              size={32}
              playing
            />
            <div className="min-w-0 flex-1">
              <p role="status" className="text-sm font-medium text-foreground">
                {preparing
                  ? "Setting up the workspace…"
                  : `${agent.name} is starting…`}
              </p>
              <p className="text-xs text-muted-foreground">
                {failing
                  ? workspaceFailureSentence(failing)
                  : "Type now. Your message is sent once the agent is ready."}
              </p>
            </div>
            <SkipTheWait agent={agent} />
          </div>
          {slow && (
            <p
              role="status"
              className="flex items-center gap-1.5 text-sm text-warning"
            >
              <Warning size={14} className="shrink-0" />
              Starting is taking longer than usual.
            </p>
          )}
          {slow && agent.notReadyMessage && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-xs text-muted-foreground">
              {agent.notReadyMessage}
            </pre>
          )}
          {agent.podTerminationReason && (
            <p className="flex items-center gap-1.5 font-mono text-sm text-danger">
              <Warning size={14} className="shrink-0" />
              {agent.podTerminationReason}
            </p>
          )}
          {display.powerAction === "restart" && (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => restart(agent.id)}
              disabled={restarting}
            >
              <Renew size={14} /> Restart agent
            </Button>
          )}
        </div>
      </ChatColumn>
    </div>
  );
}

function SkipTheWait({ agent }: { agent: AgentView }) {
  const updateAgent = useUpdateAgent();
  const showConfirm = useStore((s) => s.showConfirm);
  if (agent.hibernationTimeoutMin === 0) return null;

  const keepAlwaysOn = async () => {
    const ok = await showConfirm(
      "This agent will never hibernate — it stays running and consumes resources until you set a timeout again in the agent settings.",
      "Keep always on?",
      { icon: Power, confirmLabel: "Keep always on" },
    );
    if (ok) updateAgent.mutate({ id: agent.id, hibernationTimeoutMin: 0 });
  };

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={updateAgent.isPending}
      onClick={() => void keepAlwaysOn()}
      data-testid="skip-the-wait"
    >
      <Power size={14} /> Skip the wait — keep always-on
    </Button>
  );
}
