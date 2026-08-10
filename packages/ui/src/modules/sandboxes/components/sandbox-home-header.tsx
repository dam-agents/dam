import { OverflowMenuVertical, Renew } from "@carbon/icons-react";

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

import { StatusBadge } from "../../../components/status-indicator.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import {
  useDeleteAgent,
  useUpgradeAgentMutation,
} from "../../agents/api/mutations.js";
import { useRestartAgent } from "../../agents/hooks/use-restart-agent.js";
import { useSuspendAgent } from "../../agents/hooks/use-suspend-agent.js";
import { useWakeAgent } from "../../agents/hooks/use-wake-agent.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";
import { fetchSchedulesForAgent } from "../../schedules/api/queries.js";

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
  const upgrade = useUpgradeAgentMutation();

  const onStop = async () => {
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

  const onUpgrade = async () => {
    const update = agent.templateUpdate!;
    const msg = (
      <>
        Upgrade sandbox{" "}
        <strong className="text-foreground">"{agent.name}"</strong> from{" "}
        <code>{update.fromImage}</code> to <code>{update.toImage}</code>?
      </>
    );
    if (!(await showConfirm(msg, "Upgrade Sandbox"))) return;
    upgrade.mutate({ id: agent.id, expectedToImage: update.toImage });
  };

  return (
    <PageHeader
      title={agent.name}
      adornment={<StatusBadge state={display.state} />}
      actions={
        <>
          {agent.templateUpdate && (
            <Tooltip
              side="bottom"
              className="w-[300px] rounded-xl border border-border bg-popover p-4 shadow-xl"
              content={
                <div className="flex items-start gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                    <Renew size={16} className="text-accent" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-foreground">
                      Update available
                    </p>
                    <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
                      Latest:{" "}
                      <span className="font-mono text-[12px] text-foreground">
                        {agent.templateUpdate.toImage}
                      </span>
                    </p>
                  </div>
                </div>
              }
            >
              <Button
                variant="ghost"
                size="sm"
                disabled={upgrade.isPending}
                onClick={() => void onUpgrade()}
                className="font-medium text-accent hover:bg-accent-light hover:text-accent-hover"
              >
                <Renew className="size-4" />
                Update
              </Button>
            </Tooltip>
          )}
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
