import { Button } from "@/components/ui/button";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { PageHeader } from "@/components/ui/page-header";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { AgentRow } from "../../agents/components/agent-row.js";
import { OutdatedTemplatesBanner } from "../../agents/components/outdated-templates-banner.js";
import { useAgentRows } from "../../agents/hooks/use-agent-rows.js";
import { isKnowledgeBase } from "../../agents/utils/agent-kind.js";
import { useKbShareList } from "../api/kb-share-queries.js";
import { confirmDeleteKnowledgeBase } from "../lib/confirm-delete.js";

function shareSubtitleNote(
  subtitle: string,
  publishState: string | undefined,
): string {
  if (publishState === undefined) return subtitle;
  const note = publishState === "failed" ? "Share update failed" : "Shared";
  return subtitle ? `${subtitle} · ${note}` : note;
}

export function KnowledgeBasesListView() {
  const { agentsData, initialLoaded, rowProps, deleteAgent } = useAgentRows();
  const knowledgeBases = (agentsData?.list ?? []).filter(isKnowledgeBase);
  const shares = useKbShareList(knowledgeBases.length > 0);
  const shareByAgent = new Map(
    (shares.data ?? []).map((s) => [s.agentId, s.publishState]),
  );

  const openKnowledgeBase = useStore((s) => s.openKnowledgeBase);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const setView = useStore((s) => s.setView);
  const createKnowledgeBase = () => setView("knowledge-base-new");
  const showConfirm = useStore((s) => s.showConfirm);

  const deleteKnowledgeBase = async (agent: AgentView) => {
    if (!(await confirmDeleteKnowledgeBase(showConfirm, agent.name))) return;
    deleteAgent.mutate({ id: agent.id });
  };

  return (
    <div>
      <PageHeader
        title="Knowledge bases"
        description={
          knowledgeBases.length > 0
            ? "A knowledge base is an agent that builds and maintains a wiki in its workspace. Open one to work with it in chat — ask questions and add to it."
            : undefined
        }
        actions={
          knowledgeBases.length > 0 ? (
            <Button onClick={createKnowledgeBase}>Create knowledge base</Button>
          ) : undefined
        }
      />

      {!initialLoaded && <ListSkeleton rows={2} rowHeight={70} />}

      {initialLoaded && (
        <OutdatedTemplatesBanner
          agents={knowledgeBases}
          noun="knowledge bases"
        />
      )}

      {initialLoaded && knowledgeBases.length === 0 && (
        <PageEmptyState
          title="No knowledge bases yet"
          message="A knowledge base is an agent that builds and maintains a wiki you can chat with. Point it at a repo or docs, or add knowledge as you go. Create an agent with the knowledge base preset to get started."
          actionLabel="Create knowledge base"
          onAction={createKnowledgeBase}
        />
      )}

      <div className="flex flex-col gap-3">
        {initialLoaded &&
          knowledgeBases.map((agent) => {
            const props = rowProps(agent);
            return (
              <AgentRow
                key={agent.id}
                {...props}
                subtitle={shareSubtitleNote(
                  props.subtitle,
                  shareByAgent.get(agent.id),
                )}
                onSelect={() => openKnowledgeBase(agent.id)}
                onConfigure={() => navigateToSandboxHome(agent.id)}
                configureLabel="Configure knowledge base"
                onShare={() =>
                  navigateToSandboxHome(agent.id, "setup", "knowledge")
                }
                shareLabel="Share knowledge base"
                onDelete={() => void deleteKnowledgeBase(agent)}
              />
            );
          })}
      </div>
    </div>
  );
}
