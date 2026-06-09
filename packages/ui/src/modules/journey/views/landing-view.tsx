import { Add } from "@carbon/icons-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { useStore } from "../../../store.js";
import { useDeleteAgent, useWakeAgent } from "../../agents/api/mutations.js";
import { useAgents } from "../../agents/api/queries.js";
import { ConfigureAgentDialog } from "../../agents/dialogs/configure-agent-dialog.js";
import {
  useRestartAgent,
  useSyncRestartingAgents,
} from "../../agents/hooks/use-restart-agent.js";
import { resolveAgentDisplay } from "../../agents/utils/agent-resolver.js";
import type { Harness } from "../../v2/lib/harnesses.js";
import { EMPTY_SNAPSHOT, saveSnapshot } from "../../v2/lib/wizard-snapshot.js";
import { AgentCard } from "../components/agent-card.js";
import { HarnessPicker } from "../components/harness-picker.js";
import { RailShell } from "../components/rail-shell.js";

export function LandingView() {
  const { data, isSuccess: loaded } = useAgents();
  const agents = data?.list ?? [];
  const restartingAgents = useStore((s) => s.restartingAgents);
  useSyncRestartingAgents();

  const deleteAgent = useDeleteAgent();
  const wakeAgent = useWakeAgent();
  const { restart } = useRestartAgent();
  const setView = useStore((s) => s.setView);
  const openAgentTerminal = useStore((s) => s.openAgentTerminal);
  const showConfirm = useStore((s) => s.showConfirm);

  const [configAgentId, setConfigAgentId] = useState<string | null>(null);

  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );

  const configAgent = configAgentId
    ? (agents.find((a) => a.id === configAgentId) ?? null)
    : null;

  const isEmpty = loaded && agents.length === 0;

  // From the empty-state landing, picking a harness jumps straight to the
  // Configure step (this page is itself step 1).
  const start = (harness: Harness, image = "") => {
    saveSnapshot({
      ...EMPTY_SNAPSHOT,
      harness,
      customImage: image,
      name: "my-sandbox",
    });
    setView("new-sandbox");
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

  return (
    <RailShell>
      {!loaded ? (
        <div className="flex flex-col gap-4">
          <div className="mb-2 h-7 w-44 rounded bg-muted anim-pulse" />
          <Card className="h-[68px] anim-pulse" />
          <Card className="h-[68px] anim-pulse" />
        </div>
      ) : isEmpty ? (
        <>
          <h1 className="mb-8 text-[28px] font-bold tracking-[-0.01em] text-foreground">
            Create a sandbox
          </h1>
          <HarnessPicker
            onPickHarness={(harness) => start(harness)}
            onPickCustom={(image) => start("custom", image)}
          />
        </>
      ) : (
        <>
          <div className="mb-6 flex items-center gap-3">
            <h1 className="text-[22px] font-bold text-foreground">Sandboxes</h1>
            <Button
              size="sm"
              className="ml-auto"
              onClick={() => setView("new-image")}
            >
              <Add /> Add Sandbox
            </Button>
          </div>
          <div className="flex flex-col gap-4">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                display={resolveAgentDisplay(agent, restartingIds)}
                onOpen={() => openAgentTerminal(agent.id)}
                onRestart={() => restart(agent.id)}
                onWake={() => wakeAgent.mutate({ id: agent.id })}
                onConfigure={() => setConfigAgentId(agent.id)}
                onDelete={() => confirmDelete(agent.id, agent.name)}
                busy={
                  deleteAgent.isPending &&
                  deleteAgent.variables?.id === agent.id
                }
              />
            ))}
          </div>
        </>
      )}

      {configAgent && (
        <ConfigureAgentDialog
          agent={configAgent}
          onClose={() => setConfigAgentId(null)}
        />
      )}
    </RailShell>
  );
}
