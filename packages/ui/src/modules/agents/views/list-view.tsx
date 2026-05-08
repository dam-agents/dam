import { KeyRound, Play, Plus, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

import { StatusBadge } from "../../../components/status-indicator.js";
import { useStore } from "../../../store.js";
import { useWakeInstance } from "../../instances/api/mutations.js";
import { useInstances } from "../../instances/api/queries.js";
import { useRestartInstance, useSyncRestartingInstances } from "../../instances/hooks/use-restart-instance.js";
import { useTemplates } from "../../templates/api/queries.js";
import { useCreateAgent, useDeleteAgent } from "../api/mutations.js";
import { useAgents } from "../api/queries.js";
import { AddAgentDialog } from "../dialogs/add-agent-dialog.js";
import { ConfigureAgentDialog } from "../dialogs/configure-agent-dialog.js";
import { resolveAgentDisplay } from "../utils/agent-resolver.js";

export function ListView() {
  const { data: templates = [], refetch: refetchTemplates } = useTemplates();
  const {
    data: agents = [],
    refetch: refetchAgents,
    isSuccess: agentsLoaded,
  } = useAgents();
  const {
    data: instancesData,
    refetch: refetchInstances,
    isSuccess: instancesLoaded,
  } = useInstances();
  const instances = instancesData?.list ?? [];
  const restartingInstances = useStore(s => s.restartingInstances);
  useSyncRestartingInstances();

  const createAgent = useCreateAgent();
  const deleteAgent = useDeleteAgent();
  const { restart: restartInstance } = useRestartInstance();
  const wakeInstance = useWakeInstance();

  const selectInstance = useStore(s => s.selectInstance);
  const setView = useStore(s => s.setView);
  const showConfirm = useStore(s => s.showConfirm);

  const [showAddAgent, setShowAddAgent] = useState(false);
  const [configAgentId, setConfigAgentId] = useState<string | null>(null);

  const initialLoaded = agentsLoaded && instancesLoaded;
  const busyAgent = createAgent.isPending;

  const restartingIds = useMemo(
    () => new Set(restartingInstances.keys()),
    [restartingInstances],
  );

  const configAgent = configAgentId ? agents.find(a => a.id === configAgentId) ?? null : null;

  return (
    <>
      <div>
        {/* Page header */}
        <div className="flex items-center gap-3 mb-8">
          <h1 className="text-[20px] md:text-[24px] font-bold text-foreground">Agents</h1>
          <div className="ml-auto flex items-center gap-2 md:gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => { refetchTemplates(); refetchAgents(); refetchInstances(); }}
              aria-label="Refresh"
            >
              <RefreshCw />
            </Button>
            <Button
              onClick={() => setShowAddAgent(true)}
              disabled={busyAgent}
            >
              <Plus /> <span className="hidden sm:inline">Add</span> Agent
            </Button>
          </div>
        </div>

        {/* Skeleton during initial load — only when we expect agents */}
        {!initialLoaded && agents.length > 0 && (
          <div className="flex flex-col gap-6">
            <div className="rounded-xl border border-border bg-card h-[88px] anim-pulse" />
            <div className="rounded-xl border border-border bg-card h-[88px] anim-pulse" />
          </div>
        )}

        {/* Empty state — consistent placeholder when no agents exist */}
        {initialLoaded && agents.length === 0 && !busyAgent && (
          <div className="rounded-xl border border-border bg-card px-6 py-8 text-center text-[14px] text-muted-foreground anim-in">
            No agents yet
          </div>
        )}

        {/* One row per agent — the 1:N agent→instance cardinality is hidden. */}
        <div className="flex flex-col gap-6">
          {initialLoaded && agents.map(agent => {
            const display = resolveAgentDisplay(agent, instances, restartingIds);
            const inst = display.instance;
            const onOpen = () => { if (inst && display.clickable) selectInstance(inst.id); };
            return (
              <div
                key={agent.id}
                onClick={onOpen}
                className={`rounded-xl border border-input bg-card overflow-hidden anim-in shadow-sm transition-shadow ${display.clickable ? "group cursor-pointer hover:not-has-[button:hover]:shadow-md" : ""}`}
              >
                <div className="px-4 md:px-6 py-4 md:py-5">
                  <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <h2 className="text-[16px] md:text-[17px] font-bold text-foreground transition-colors [.group:hover:not(:has(button:hover))_&]:text-primary">{agent.name}</h2>
                        <StatusBadge state={display.state} />
                      </div>
                      {agent.description && (
                        <p className="text-[13px] text-foreground/80">{agent.description}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0 flex-wrap" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (!inst) return;
                          if (display.powerAction === "start") wakeInstance.mutate({ id: inst.id });
                          else if (display.powerAction === "restart") restartInstance(inst.id);
                        }}
                        disabled={display.powerAction === null}
                        title={display.powerAction === "start" ? "Wake the hibernated agent" : "Restart the agent pod"}
                      >
                        {display.powerAction === "start"
                          ? (<><Play /> Start</>)
                          : (<><RotateCw /> Restart</>)}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfigAgentId(agent.id)}
                        title="Configure agent credentials and env vars"
                      >
                        <KeyRound /> Configure
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={async () => {
                          const msg = (
                            <div className="space-y-2">
                              <p>Delete agent <strong className="text-foreground">"{agent.name}"</strong>?</p>
                              <p className="text-destructive">
                                This will also delete <strong>all persistent data</strong>.
                              </p>
                              <p className="text-muted-foreground text-[12px]">This cannot be undone.</p>
                            </div>
                          );
                          if (!await showConfirm(msg, "Delete Agent")) return;
                          deleteAgent.mutate({ id: agent.id });
                        }}
                        disabled={deleteAgent.isPending && deleteAgent.variables?.id === agent.id}
                        className="text-muted-foreground hover:text-destructive"
                        title="Delete agent"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showAddAgent && (
        <AddAgentDialog
          templates={templates}
          onSubmit={async (input) => { setShowAddAgent(false); await createAgent.mutateAsync(input); }}
          onCancel={() => setShowAddAgent(false)}
          onGoToProviders={() => { setShowAddAgent(false); setView("providers"); }}
        />
      )}
      {configAgent && (
        <ConfigureAgentDialog
          agent={configAgent}
          onClose={() => setConfigAgentId(null)}
        />
      )}
    </>
  );
}
