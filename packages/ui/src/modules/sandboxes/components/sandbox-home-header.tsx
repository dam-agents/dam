import { Chat, LetterZz, Play, Restart, TrashCan } from "@carbon/icons-react";

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
import { useConfirmDeleteAgent } from "../../agents/hooks/use-confirm-delete-agent.js";
import { useRestartAgent } from "../../agents/hooks/use-restart-agent.js";
import { useSleepAgent } from "../../agents/hooks/use-sleep-agent.js";
import { useUpdateSandbox } from "../../agents/hooks/use-update-sandbox.js";
import { useWakeAgent } from "../../agents/hooks/use-wake-agent.js";
import {
  SLEEP_HINT,
  SLEEP_UNAVAILABLE_REASON,
} from "../../agents/lib/sleep-copy.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";

interface Props {
  agent: AgentView;
  display: AgentDisplay;
}

export function SandboxIdentity({ agent, display }: Props) {
  return (
    <div className="mb-4 flex flex-col gap-2 px-3">
      <div className="flex min-w-0 items-center gap-3">
        <EditableAgentIdentity
          agent={agent}
          avatarSize={36}
          mood={avatarMood(display.state, agent.stopRequested)}
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
  const confirmDelete = useConfirmDeleteAgent();
  const wakeAgent = useWakeAgent();
  const { restart } = useRestartAgent();
  const deleteAgent = useDeleteAgent();
  const sleep = useSleepAgent();
  const { updateOne, updatingId } = useUpdateSandbox();

  const openChat = () => selectAgent(agent.id);

  const onDelete = async () => {
    if (!(await confirmDelete(agent))) return;
    deleteAgent.mutate({ id: agent.id });
    setView("home");
  };

  const running = display.state === "running";
  const neverSleeps = agent.hibernationTimeoutMin === 0;
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
            busy={updatingId !== null}
            onUpdate={() => void updateOne(agent)}
          />
          <Button variant="outline" onClick={openChat}>
            <Chat />
            Chat
          </Button>
          {separator}
          <Button
            variant="outline"
            size="icon"
            aria-label="Sleep"
            disabled={!running || neverSleeps}
            tooltip={
              neverSleeps ? SLEEP_UNAVAILABLE_REASON : `Sleep ${SLEEP_HINT}`
            }
            onClick={() => sleep(agent.id)}
            data-testid="agent-sleep"
          >
            <LetterZz />
          </Button>
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
