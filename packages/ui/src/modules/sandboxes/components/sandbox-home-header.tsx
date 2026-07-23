import { OverflowMenuVertical } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/ui/page-header";

import { StatusBadge } from "../../../components/status-indicator.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useDeleteAgent } from "../../agents/api/mutations.js";
import { useRestartAgent } from "../../agents/hooks/use-restart-agent.js";
import { useSuspendAgent } from "../../agents/hooks/use-suspend-agent.js";
import { useWakeAgent } from "../../agents/hooks/use-wake-agent.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";
import { fetchSchedulesForAgent } from "../../schedules/api/queries.js";
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
  const suspend = useSuspendAgent();

  const onStop = async () => {
    // Schedules override a stop by design (#1900) — say so before it lands.
    const schedules = await fetchSchedulesForAgent(agent.id);
    const scheduleNote =
      schedules.length > 0 ? (
        <>
          {" "}
          This sandbox has <strong>{schedules.length} schedule(s)</strong> — the
          next fire will start it again.
        </>
      ) : null;
    const msg = (
      <>
        Stop sandbox <strong className="text-foreground">"{agent.name}"</strong>
        ? It stays stopped until you start it.{scheduleNote}
      </>
    );
    if (!(await showConfirm(msg, "Stop Sandbox"))) return;
    suspend.stop(agent.id);
  };

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
    <PageHeader
      title={agent.name}
      adornment={
        <>
          <StatusBadge state={display.state} />
          {agent.templateUpdate && (
            <Badge
              variant="accent"
              className="shrink-0"
              title={`Template update available: ${agent.templateUpdate.toImage}`}
            >
              Update available
            </Badge>
          )}
        </>
      }
      actions={
        <>
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
              {display.state === "running" && (
                <>
                  <DropdownMenuItem onSelect={() => suspend.pause(agent.id)}>
                    Pause — wakes on next use
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void onStop()}>
                    Stop — until started again
                  </DropdownMenuItem>
                </>
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
        </>
      }
    />
  );
}
