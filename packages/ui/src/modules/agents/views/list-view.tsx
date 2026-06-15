import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import type { AgentView, TemplateView } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { useSecrets } from "../../secrets/api/queries.js";
import { useTemplates } from "../../templates/api/queries.js";
import { useCreateAgent, useDeleteAgent } from "../api/mutations.js";
import { useAgents } from "../api/queries.js";
import { AgentRow } from "../components/agent-row.js";
import { AddAgentDialog } from "../dialogs/add-agent-dialog.js";
import { ConfigureAgentDialog } from "../dialogs/configure-agent-dialog.js";
import {
  useRestartAgent,
  useSyncRestartingAgents,
} from "../hooks/use-restart-agent.js";
import { useWakeAgent } from "../hooks/use-wake-agent.js";
import { resolveAgentDisplay } from "../utils/agent-resolver.js";
import {
  sandboxSubtitle,
  type SandboxSubtitleLookup,
} from "../utils/sandbox-subtitle.js";

// Stable fallback so `subtitleLookup`'s memo isn't defeated while the
// templates query has no data yet.
const NO_TEMPLATES: TemplateView[] = [];

export function ListView() {
  const { data: templatesData } = useTemplates();
  const templates = templatesData ?? NO_TEMPLATES;
  const { data: agentsData } = useAgents();
  const connections = useAppConnections();
  const secrets = useSecrets();
  const agents = agentsData?.list ?? [];
  const restartingAgents = useStore((s) => s.restartingAgents);
  useSyncRestartingAgents();

  const createAgent = useCreateAgent();
  const deleteAgent = useDeleteAgent();
  const { restart: restartAgent } = useRestartAgent();
  const wakeAgent = useWakeAgent();

  const selectAgent = useStore((s) => s.selectAgent);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const showConfirm = useStore((s) => s.showConfirm);

  const [showAddAgent, setShowAddAgent] = useState(false);
  const [configAgentId, setConfigAgentId] = useState<string | null>(null);

  // Gate on data presence, not query success: a transient poll failure keeps
  // the cached list rendered instead of flashing skeletons over it.
  const initialLoaded = agentsData !== undefined;
  const busyAgent = createAgent.isPending;

  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );

  const subtitleLookup = useMemo<SandboxSubtitleLookup>(
    () => ({
      templateNameById: new Map(templates.map((t) => [t.id, t.name])),
      connectionTemplateIdById: new Map(
        (connections.data ?? []).map((c) => [c.id, c.templateId]),
      ),
      secretTypeById: new Map((secrets.data ?? []).map((s) => [s.id, s.type])),
    }),
    [templates, connections.data, secrets.data],
  );

  const configAgent = configAgentId
    ? (agents.find((a) => a.id === configAgentId) ?? null)
    : null;

  const deleteSandbox = async (agent: AgentView) => {
    const msg = (
      <>
        Delete sandbox{" "}
        <strong className="text-foreground">"{agent.name}"</strong>? This will
        also delete <strong>all persistent data</strong> and cannot be undone.
      </>
    );
    if (!(await showConfirm(msg, "Delete Sandbox", { kind: "destructive" })))
      return;
    deleteAgent.mutate({ id: agent.id });
  };

  return (
    <>
      <div className="mx-auto w-full max-w-[666px]">
        {/* Page header */}
        <div className="mb-8 flex items-center justify-between gap-3">
          <h1 className="text-[24px] font-semibold tracking-[-0.65px] text-foreground md:text-[28px]">
            Sandboxes
          </h1>
          <Button onClick={() => setShowAddAgent(true)} disabled={busyAgent}>
            Create sandbox
          </Button>
        </div>

        {/* Skeleton during the initial load, before the first fetch resolves. */}
        {!initialLoaded && <ListSkeleton rows={2} rowHeight={70} />}

        {/* Empty state — the header's Create sandbox button is the only CTA. */}
        {initialLoaded && agents.length === 0 && !busyAgent && (
          <Card className="border border-border px-6 py-10 text-center text-[14px] text-muted-foreground anim-in">
            No sandboxes yet
          </Card>
        )}

        {/* One row per sandbox. */}
        <div className="flex flex-col gap-3">
          {initialLoaded &&
            agents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                display={resolveAgentDisplay(agent, restartingIds)}
                subtitle={sandboxSubtitle(agent, subtitleLookup)}
                deletePending={
                  deleteAgent.isPending &&
                  deleteAgent.variables?.id === agent.id
                }
                onSelect={() => selectAgent(agent.id)}
                onWake={() => wakeAgent.wake(agent.id)}
                onRestart={() => restartAgent(agent.id)}
                onConfigure={() => setConfigAgentId(agent.id)}
                onDelete={() => void deleteSandbox(agent)}
              />
            ))}
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
            navigateToSettings("providers");
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
