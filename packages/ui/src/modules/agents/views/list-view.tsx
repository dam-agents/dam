import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import type { AgentView, TemplateView } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { useTemplates } from "../../templates/api/queries.js";
import { useDeleteAgent } from "../api/mutations.js";
import { useAgents } from "../api/queries.js";
import { AgentRow } from "../components/agent-row.js";
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
  const agents = agentsData?.list ?? [];
  const restartingAgents = useStore((s) => s.restartingAgents);
  useSyncRestartingAgents();

  const deleteAgent = useDeleteAgent();
  const { restart: restartAgent } = useRestartAgent();
  const wakeAgent = useWakeAgent();

  const navigateToCreateSandbox = useStore((s) => s.navigateToCreateSandbox);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const showConfirm = useStore((s) => s.showConfirm);

  // Gate on data presence, not query success: a transient poll failure keeps
  // the cached list rendered instead of flashing skeletons over it.
  const initialLoaded = agentsData !== undefined;

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
    }),
    [templates, connections.data],
  );

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
    <div className="mx-auto w-full max-w-[666px]">
      <div className="mb-8 flex items-center justify-between gap-3">
        <h1 className="text-[24px] font-semibold tracking-[-0.65px] text-foreground md:text-[28px]">
          Sandboxes
        </h1>
        {agents.length > 0 && (
          <Button onClick={navigateToCreateSandbox}>Create sandbox</Button>
        )}
      </div>

      {!initialLoaded && <ListSkeleton rows={2} rowHeight={70} />}

      {initialLoaded && agents.length === 0 && (
        <Card className="flex flex-col items-center gap-3 border border-border px-6 py-12 text-center anim-in">
          <h2 className="text-[16px] font-semibold text-foreground">
            No sandboxes yet
          </h2>
          <p className="text-[14px] text-muted-foreground">
            Create your first sandbox to get started.
          </p>
          <Button className="mt-1" onClick={navigateToCreateSandbox}>
            Create sandbox
          </Button>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {initialLoaded &&
          agents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              display={resolveAgentDisplay(agent, restartingIds)}
              subtitle={sandboxSubtitle(agent, subtitleLookup)}
              deletePending={
                deleteAgent.isPending && deleteAgent.variables?.id === agent.id
              }
              onSelect={() => navigateToSandboxHome(agent.id)}
              onWake={() => wakeAgent.wake(agent.id)}
              onRestart={() => restartAgent(agent.id)}
              onDelete={() => void deleteSandbox(agent)}
            />
          ))}
      </div>
    </div>
  );
}
