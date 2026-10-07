import { Chat, OverflowMenuVertical } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/ui/page-header";
import { Tooltip } from "@/components/ui/tooltip";

import {
  AlwaysOnTag,
  StatusBadge,
} from "../../../components/status-indicator.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useDeleteAgent } from "../../agents/api/mutations.js";
import {
  AgentAvatar,
  isAsleep,
} from "../../agents/components/avatar/agent-avatar.js";
import { FreeUpComputeItems } from "../../agents/components/power-menu-items.js";
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
  avatarName?: string;
}

export function SandboxHomeHeader({ agent, display, avatarName }: Props) {
  const working = useFeed().workingByAgent.get(agent.id);
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
    if (!(await showConfirm(msg, "Delete Agent", { kind: "destructive" })))
      return;
    deleteAgent.mutate({ id: agent.id }, { onSuccess: () => setView("home") });
  };

  return (
    <PageHeader
      leading={
        <AgentAvatar
          name={avatarName ?? agent.name}
          size={44}
          sleeping={isAsleep(display.state)}
          stopped={agent.stopRequested}
        />
      }
      title={agent.name}
      adornment={
        <>
          <StatusBadge state={display.state} working={working} />
          {agent.hibernationTimeoutMin === 0 && <AlwaysOnTag />}
        </>
      }
      actions={
        <>
          <UpdateAvailableAction
            agent={agent}
            pending={updatingId === agent.id}
            busy={updatingId !== null || updatingAll}
            onUpdate={() => void updateOne(agent)}
          />
          <Tooltip content="Open chat">
            <Button
              size="icon"
              aria-label="Open chat"
              variant="outline"
              onClick={openChat}
            >
              <Chat />
            </Button>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Agent actions">
                <OverflowMenuVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {display.state === "running" && (
                <FreeUpComputeItems
                  agent={agent}
                  onPause={() => suspend.pause(agent.id)}
                  onStop={() => void onStop()}
                />
              )}
              {display.powerAction === "start" ? (
                <DropdownMenuItem onSelect={() => wakeAgent.wake(agent.id)}>
                  Wake
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  disabled={display.powerAction === null}
                  onSelect={() => restart(agent.id)}
                >
                  Restart
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                tone="danger"
                disabled={deleteAgent.isPending}
                onSelect={() => void onDelete()}
              >
                Delete Agent
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    />
  );
}
