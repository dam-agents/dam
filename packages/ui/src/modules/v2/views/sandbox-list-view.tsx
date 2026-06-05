import { useMemo } from "react";

import { Card } from "@/components/ui/card";

import { useStore } from "../../../store.js";
import { useDeleteAgent } from "../../agents/api/mutations.js";
import { useAgents } from "../../agents/api/queries.js";
import { useSyncRestartingAgents } from "../../agents/hooks/use-restart-agent.js";
import { resolveAgentDisplay } from "../../agents/utils/agent-resolver.js";
import { CreateSandboxCard } from "../components/create-sandbox-card.js";
import { SandboxCard } from "../components/sandbox-card.js";
import { SandboxShell } from "../components/sandbox-shell.js";

export function SandboxListView() {
  const { data, isSuccess: loaded } = useAgents();
  const agents = data?.list ?? [];
  const restartingAgents = useStore((s) => s.restartingAgents);
  useSyncRestartingAgents();

  const deleteAgent = useDeleteAgent();
  const setView = useStore((s) => s.setView);
  const openSandboxTerminal = useStore((s) => s.openSandboxTerminal);
  const showConfirm = useStore((s) => s.showConfirm);

  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );

  const confirmDelete = async (id: string, name: string) => {
    const message = (
      <>
        Delete sandbox <strong className="text-foreground">"{name}"</strong>?
        This also deletes <strong>all persistent data</strong> and cannot be
        undone.
      </>
    );
    if (await showConfirm(message, "Delete Sandbox", { kind: "destructive" }))
      deleteAgent.mutate({ id });
  };

  return (
    <SandboxShell breadcrumbs={[{ label: "Sandboxes" }]}>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-4 py-8 md:py-12">
          <h1 className="text-[22px] font-bold text-foreground mb-6">
            Sandboxes
          </h1>
          <div className="flex flex-col gap-4">
            {loaded &&
              agents.map((agent) => (
                <SandboxCard
                  key={agent.id}
                  agent={agent}
                  display={resolveAgentDisplay(agent, restartingIds)}
                  onOpen={() => openSandboxTerminal(agent.id)}
                  onDelete={() => confirmDelete(agent.id, agent.name)}
                  deleting={
                    deleteAgent.isPending &&
                    deleteAgent.variables?.id === agent.id
                  }
                />
              ))}
            {!loaded && <Card className="h-[68px] anim-pulse" />}
            <CreateSandboxCard onClick={() => setView("v2-new")} />
          </div>
        </div>
      </div>
    </SandboxShell>
  );
}
