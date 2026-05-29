import {
  Add as Plus,
  Password as KeyRound,
  Play,
  Renew as RotateCw,
  TrashCan as Trash2,
} from "@carbon/icons-react";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { StatusBadge } from "../../../components/status-indicator.js";
import { useStore } from "../../../store.js";
import { useTemplates } from "../../templates/api/queries.js";
import {
  useCreateAgent,
  useDeleteAgent,
  useWakeAgent,
} from "../api/mutations.js";
import { useAgents } from "../api/queries.js";
import { AddAgentDialog } from "../dialogs/add-agent-dialog.js";
import { ConfigureAgentDialog } from "../dialogs/configure-agent-dialog.js";
import {
  useRestartAgent,
  useSyncRestartingAgents,
} from "../hooks/use-restart-agent.js";
import { resolveAgentDisplay } from "../utils/agent-resolver.js";

export function ListView() {
  const { data: templates = [] } = useTemplates();
  const { data: agentsData, isSuccess: agentsLoaded } = useAgents();
  const agents = agentsData?.list ?? [];
  const restartingAgents = useStore((s) => s.restartingAgents);
  useSyncRestartingAgents();

  const createAgent = useCreateAgent();
  const deleteAgent = useDeleteAgent();
  const { restart: restartAgent } = useRestartAgent();
  const wakeAgent = useWakeAgent();

  const selectAgent = useStore((s) => s.selectAgent);
  const setView = useStore((s) => s.setView);
  const showConfirm = useStore((s) => s.showConfirm);

  const [showAddAgent, setShowAddAgent] = useState(false);
  const [configAgentId, setConfigAgentId] = useState<string | null>(null);

  const initialLoaded = agentsLoaded;
  const busyAgent = createAgent.isPending;

  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );

  const configAgent = configAgentId
    ? (agents.find((a) => a.id === configAgentId) ?? null)
    : null;

  return (
    <>
      <div className="w-full max-w-2xl">
        {/* Page header — only renders once at least one agent exists. On
            the empty state the EmptyState card's own title ("Add your
            first agent") carries the page heading, so the redundant h1
            stays hidden until there's content to label. */}
        {initialLoaded && agents.length > 0 && (
          <div className="flex items-center gap-3 mb-8">
            <h1 className="text-[20px] md:text-[24px] font-bold text-foreground">
              Agents
            </h1>
            <div className="ml-auto flex items-center gap-2 md:gap-3">
              <Button
                id="tour-add-agent"
                onClick={() => setShowAddAgent(true)}
                disabled={busyAgent}
              >
                <Plus /> <span className="hidden sm:inline">Add</span> Agent
              </Button>
            </div>
          </div>
        )}

        {/* Skeleton during initial load — only when we expect agents */}
        {!initialLoaded && agents.length > 0 && (
          <div className="flex flex-col gap-6">
            <Card className="h-[88px] anim-pulse" />
            <Card className="h-[88px] anim-pulse" />
          </div>
        )}

        {/* Rich empty state coaches first-run users on what an agent is and
            what they can do once one's spun up. */}
        {initialLoaded && agents.length === 0 && !busyAgent && (
          <EmptyState
            palette="aurora"
            title="Add your first agent"
            description={
              <>
                Agents are AI harnesses — Claude Code, Codex, Gemini CLI — that
                run headless in the cloud. They keep working between sessions,
                so you can close your laptop, come back later, and pick up where
                the agent left off.
              </>
            }
            bullets={[
              <>
                <span className="font-semibold">Persistent</span> — keeps state
                and context across sessions.
              </>,
              <>
                <span className="font-semibold">Network-isolated</span> — only
                reaches hosts you allow, with credentials injected at the
                gateway.
              </>,
              <>
                <span className="font-semibold">Schedulable</span> — trigger an
                agent on a cron and let it work while you're away.
              </>,
            ]}
            action={
              <Button
                onClick={() => setShowAddAgent(true)}
                disabled={busyAgent}
              >
                <Plus /> Add Agent
              </Button>
            }
          />
        )}

        {/* One row per agent. */}
        <div className="flex flex-col gap-6">
          {initialLoaded &&
            agents.map((agent) => {
              const display = resolveAgentDisplay(agent, restartingIds);
              const onOpen = () => {
                if (display.clickable) selectAgent(agent.id);
              };
              return (
                <Card
                  key={agent.id}
                  onClick={onOpen}
                  className={`overflow-hidden anim-in transition-shadow ${display.clickable ? "group cursor-pointer hover:not-has-[button:hover]:shadow-md" : ""}`}
                >
                  <div className="px-4 md:px-6 py-4 md:py-5">
                    <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          <h2 className="text-[16px] md:text-[17px] font-bold text-foreground transition-colors [.group:hover:not(:has(button:hover))_&]:text-primary">
                            {agent.name}
                          </h2>
                          <StatusBadge state={display.state} />
                        </div>
                        {agent.description && (
                          <p className="text-[13px] text-foreground/80">
                            {agent.description}
                          </p>
                        )}
                      </div>

                      <div
                        className="flex items-center gap-2 shrink-0 flex-wrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (display.powerAction === "start")
                              wakeAgent.mutate({ id: agent.id });
                            else if (display.powerAction === "restart")
                              restartAgent(agent.id);
                          }}
                          disabled={display.powerAction === null}
                          title={
                            display.powerAction === "start"
                              ? "Wake the hibernated agent"
                              : "Restart the agent pod"
                          }
                        >
                          {display.powerAction === "start" ? (
                            <>
                              <Play /> Start
                            </>
                          ) : (
                            <>
                              <RotateCw /> Restart
                            </>
                          )}
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
                              <>
                                Are you sure you want to remove{" "}
                                <strong className="text-foreground">
                                  "{agent.name}"
                                </strong>
                                ? This will also delete all persistent data and
                                cannot be undone.
                              </>
                            );
                            if (
                              !(await showConfirm(msg, "Remove Agent?", {
                                kind: "destructive",
                                confirmLabel: "Remove agent",
                              }))
                            )
                              return;
                            deleteAgent.mutate({ id: agent.id });
                          }}
                          disabled={
                            deleteAgent.isPending &&
                            deleteAgent.variables?.id === agent.id
                          }
                          className="text-muted-foreground hover:text-destructive"
                          title="Delete agent"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
        </div>
      </div>

      {showAddAgent && (
        <AddAgentDialog
          templates={templates}
          onSubmit={async (input) => {
            setShowAddAgent(false);
            await createAgent.mutateAsync(input);
          }}
          onCancel={() => setShowAddAgent(false)}
          onGoToProviders={() => {
            setShowAddAgent(false);
            setView("providers");
          }}
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
