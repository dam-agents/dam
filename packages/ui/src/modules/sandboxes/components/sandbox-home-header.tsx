import {
  Chat,
  Pause,
  Play,
  Restart,
  Stop,
  TrashCan,
} from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

import { AlwaysOnTag } from "../../../components/status-indicator.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useDeleteAgent } from "../../agents/api/mutations.js";
import { avatarMood } from "../../agents/components/avatar/agent-avatar.js";
import { EditableAgentIdentity } from "../../agents/components/editable-agent-identity.js";
import { GatewayFailureBadge } from "../../agents/components/gateway-failure-badge.js";
import { UpdateAvailableAction } from "../../agents/components/update-available-action.js";
import { useConfirmStopAgent } from "../../agents/hooks/use-confirm-stop-agent.js";
import { useRestartAgent } from "../../agents/hooks/use-restart-agent.js";
import { useSuspendAgent } from "../../agents/hooks/use-suspend-agent.js";
import { useUpdateSandbox } from "../../agents/hooks/use-update-sandbox.js";
import { useWakeAgent } from "../../agents/hooks/use-wake-agent.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";
import { useFeed } from "../../home/api/queries.js";

interface Props {
  agent: AgentView;
  display: AgentDisplay;
}

export function SandboxIdentity({ agent, display }: Props) {
  const working = useFeed().workingByAgent.get(agent.id);
  return (
    <div className="mb-4 flex flex-col gap-2 px-3">
      <div className="flex min-w-0 items-center gap-3">
        <EditableAgentIdentity
          agent={agent}
          avatarSize={36}
          mood={avatarMood(
            display.state,
            agent.stopRequested,
            working ?? false,
          )}
          nameClassName="text-lg font-semibold text-foreground"
          nameTag="h2"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 empty:hidden">
        <GatewayFailureBadge agent={agent} />
        {agent.hibernationTimeoutMin === 0 && <AlwaysOnTag />}
      </div>
    </div>
  );
}

export function SandboxHomeHeader({
  agent,
  display,
  title,
  description,
}: Props & { title: string; description?: string }) {
  const setView = useStore((s) => s.setView);
  const selectAgent = useStore((s) => s.selectAgent);
  const showConfirm = useStore((s) => s.showConfirm);
  const wakeAgent = useWakeAgent();
  const { restart } = useRestartAgent();
  const deleteAgent = useDeleteAgent();
  const suspend = useSuspendAgent();
  const confirmStop = useConfirmStopAgent();
  const { updateOne, updatingId, updatingAll } = useUpdateSandbox();

  const openChat = () => selectAgent(agent.id);

  const onStop = async () => {
    if (!(await confirmStop(agent))) return;
    suspend.stop(agent.id);
  };

  const onDelete = async () => {
    const msg = (
      <>
        Delete agent <strong className="text-foreground">"{agent.name}"</strong>
        ? This will also delete <strong>all persistent data</strong> and cannot
        be undone.
      </>
    );
    if (
      !(await showConfirm(msg, "Delete agent?", {
        kind: "destructive",
        confirmLabel: "Delete agent",
      }))
    )
      return;
    deleteAgent.mutate({ id: agent.id });
    setView("home");
  };

  const neverHibernates = agent.hibernationTimeoutMin === 0;
  const separator = <span aria-hidden className="mx-1 h-6 w-px bg-border" />;

  return (
    <PageHeader
      title={title}
      description={description}
      actions={
        <>
          <UpdateAvailableAction
            agent={agent}
            pending={updatingId === agent.id}
            busy={updatingId !== null || updatingAll}
            onUpdate={() => void updateOne(agent)}
          />
          <Button variant="outline" onClick={openChat}>
            <Chat />
            Chat
          </Button>
          {separator}
          {display.state === "running" && (
            <>
              <Button
                variant="outline"
                size="icon"
                aria-label="Pause"
                disabled={neverHibernates}
                tooltip={
                  neverHibernates
                    ? "This agent never sleeps, so pausing it would wake itself. Change its idle timeout in Sandbox."
                    : "Pause: wakes on any action (a schedule firing, a message arriving, or you opening a chat)"
                }
                onClick={() => suspend.pause(agent.id)}
                data-testid="agent-pause"
              >
                <Pause />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Stop"
                tooltip="Stop: wakes only when a schedule fires or you start it"
                onClick={() => void onStop()}
                data-testid="agent-stop"
              >
                <Stop />
              </Button>
            </>
          )}
          {display.powerAction === "start" ? (
            <Button
              variant="outline"
              size="icon"
              aria-label="Wake"
              tooltip="Wake"
              onClick={() => wakeAgent.wake(agent.id)}
            >
              <Play />
            </Button>
          ) : (
            <Button
              variant="outline"
              size="icon"
              aria-label="Restart"
              tooltip="Restart"
              disabled={display.powerAction === null}
              onClick={() => restart(agent.id)}
            >
              <Restart />
            </Button>
          )}
          {separator}
          <Button
            variant="outline"
            size="icon"
            tone="danger"
            aria-label="Delete agent"
            tooltip="Delete agent"
            disabled={deleteAgent.isPending}
            onClick={() => void onDelete()}
          >
            <TrashCan />
          </Button>
        </>
      }
    />
  );
}
