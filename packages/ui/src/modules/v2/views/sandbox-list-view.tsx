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
import { type Harness, HARNESSES } from "../lib/harnesses.js";
import { generateSandboxName } from "../lib/sandbox-name.js";
import { EMPTY_SNAPSHOT, saveSnapshot } from "../lib/wizard-snapshot.js";

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

  const startSandbox = (harness: Harness) => {
    saveSnapshot({ ...EMPTY_SNAPSHOT, harness, name: generateSandboxName() });
    setView("v2-new");
  };

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

  const isEmpty = loaded && agents.length === 0;

  const createTiles = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {HARNESSES.map((harness) => (
        <CreateSandboxCard
          key={harness.id}
          label={harness.label}
          description={harness.tagline}
          onClick={() => startSandbox(harness.id)}
        />
      ))}
    </div>
  );

  return (
    <SandboxShell breadcrumbs={[{ label: "Sandboxes" }]}>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-4 py-8 md:py-12">
          {!loaded ? (
            <div className="flex flex-col gap-4">
              <div className="mb-2 h-7 w-44 rounded bg-muted anim-pulse" />
              <Card className="h-[68px] anim-pulse" />
              <Card className="h-[68px] anim-pulse" />
            </div>
          ) : isEmpty ? (
            <>
              <h1 className="text-[22px] font-bold text-foreground mb-6">
                Start a new sandbox
              </h1>
              {createTiles}
            </>
          ) : (
            <>
              <h1 className="text-[22px] font-bold text-foreground mb-6">
                Sandboxes
              </h1>
              <div className="flex flex-col gap-4">
                {agents.map((agent) => (
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
              </div>

              <div className="mt-8">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Start a new sandbox
                </span>
                <div className="mt-3">{createTiles}</div>
              </div>
            </>
          )}
        </div>
      </div>
    </SandboxShell>
  );
}
