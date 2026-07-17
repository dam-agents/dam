import { OverflowMenuVertical } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { StatusBadge } from "../../../components/status-indicator.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useDeleteAgent } from "../../agents/api/mutations.js";
import { useRestartAgent } from "../../agents/hooks/use-restart-agent.js";
import { useWakeAgent } from "../../agents/hooks/use-wake-agent.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";
import { OpenInMenu } from "./open-in-menu.js";

interface Props {
  agent: AgentView;
  display: AgentDisplay;
}

export function SandboxHomeHeader({ agent, display }: Props) {
  const setView = useStore((s) => s.setView);
  const showConfirm = useStore((s) => s.showConfirm);
  const wakeAgent = useWakeAgent();
  const { restart } = useRestartAgent();
  const deleteAgent = useDeleteAgent();

  const onDelete = async () => {
    const msg = (
      <>
        Delete sandbox{" "}
        <strong className="text-foreground">"{agent.name}"</strong>? This will
        also delete <strong>all persistent data</strong> and cannot be undone.
      </>
    );
    if (!(await showConfirm(msg, "Delete Sandbox", { kind: "destructive" })))
      return;
    deleteAgent.mutate({ id: agent.id }, { onSuccess: () => setView("list") });
  };

  return (
    <div className="mb-8 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="truncate text-[24px] font-semibold tracking-[-0.65px] text-foreground md:text-[28px]">
          {agent.name}
        </h1>
        <StatusBadge state={display.state} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <OpenInMenu agent={agent} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" title="Sandbox actions">
              <OverflowMenuVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
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
              Delete Sandbox
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
