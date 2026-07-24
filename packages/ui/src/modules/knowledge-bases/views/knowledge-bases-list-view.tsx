import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import type { AgentView, TemplateView } from "../../../types.js";
import { useDeleteAgent } from "../../agents/api/mutations.js";
import { useAgents } from "../../agents/api/queries.js";
import { AgentRow } from "../../agents/components/agent-row.js";
import {
  useRestartAgent,
  useSyncRestartingAgents,
} from "../../agents/hooks/use-restart-agent.js";
import {
  useSuspendAgent,
  useSyncPausingAgents,
} from "../../agents/hooks/use-suspend-agent.js";
import { useWakeAgent } from "../../agents/hooks/use-wake-agent.js";
import { resolveAgentDisplay } from "../../agents/utils/agent-resolver.js";
import {
  sandboxSubtitle,
  type SandboxSubtitleLookup,
} from "../../agents/utils/sandbox-subtitle.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { useTemplates } from "../../templates/api/queries.js";

const NO_TEMPLATES: TemplateView[] = [];

/** The Knowledge Bases surface: the owner's agents carrying the
 *  `knowledge-base` kind. Rows open straight into chat — the knowledge base
 *  is worked with conversationally, not configured first. */
export function KnowledgeBasesListView() {
  const { data: templatesData } = useTemplates();
  const templates = templatesData ?? NO_TEMPLATES;
  const { data: agentsData } = useAgents();
  const connections = useAppConnections();
  const knowledgeBases = (agentsData?.list ?? []).filter(
    (agent) => agent.kind === "knowledge-base",
  );
  const restartingAgents = useStore((s) => s.restartingAgents);
  useSyncRestartingAgents();
  const pausingAgents = useStore((s) => s.pausingAgents);
  useSyncPausingAgents();

  const deleteAgent = useDeleteAgent();
  const suspend = useSuspendAgent();
  const { restart: restartAgent } = useRestartAgent();
  const wakeAgent = useWakeAgent();

  const selectAgent = useStore((s) => s.selectAgent);
  const navigateToCreateKnowledgeBase = useStore(
    (s) => s.navigateToCreateKnowledgeBase,
  );
  const showConfirm = useStore((s) => s.showConfirm);

  const initialLoaded = agentsData !== undefined;

  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );
  const pausingIds = useMemo(
    () => new Set(pausingAgents.keys()),
    [pausingAgents],
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

  const deleteKnowledgeBase = async (agent: AgentView) => {
    const msg = (
      <>
        Delete knowledge base{" "}
        <strong className="text-foreground">"{agent.name}"</strong>? This will
        also delete <strong>all of its knowledge and data</strong> and cannot be
        undone.
      </>
    );
    if (
      !(await showConfirm(msg, "Delete Knowledge Base", {
        kind: "destructive",
      }))
    )
      return;
    deleteAgent.mutate({ id: agent.id });
  };

  return (
    <div className="mx-auto w-full max-w-[666px]">
      <PageHeader
        title="Knowledge bases"
        actions={
          knowledgeBases.length > 0 ? (
            <Button onClick={navigateToCreateKnowledgeBase}>
              New knowledge base
            </Button>
          ) : undefined
        }
      />

      {!initialLoaded && <ListSkeleton rows={2} rowHeight={70} />}

      {initialLoaded && knowledgeBases.length === 0 && (
        <Card className="flex flex-col items-center gap-3 border border-border px-6 py-12 text-center anim-in">
          <h2 className="text-[16px] font-semibold text-foreground">
            No knowledge bases yet
          </h2>
          <p className="text-[14px] text-muted-foreground">
            A knowledge base is an agent that builds and maintains a body of
            knowledge for you. Create one and it sets itself up.
          </p>
          <Button className="mt-1" onClick={navigateToCreateKnowledgeBase}>
            New knowledge base
          </Button>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {initialLoaded &&
          knowledgeBases.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              display={resolveAgentDisplay(agent, restartingIds, pausingIds)}
              subtitle={sandboxSubtitle(agent, subtitleLookup)}
              deletePending={
                deleteAgent.isPending && deleteAgent.variables?.id === agent.id
              }
              onSelect={() => selectAgent(agent.id)}
              onWake={() => wakeAgent.wake(agent.id)}
              onRestart={() => restartAgent(agent.id)}
              onPause={() => suspend.pause(agent.id)}
              onStop={() => suspend.stop(agent.id)}
              onDelete={() => void deleteKnowledgeBase(agent)}
            />
          ))}
      </div>
    </div>
  );
}
