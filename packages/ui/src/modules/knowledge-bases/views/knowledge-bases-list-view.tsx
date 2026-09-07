import type { KbShareView } from "api-server-api";

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
  share: Pick<KbShareView, "publishState" | "snapshotCreatedAt"> | undefined,
): string {
  if (share === undefined) return subtitle;
  const note =
    share.publishState === "failed"
      ? "Share update failed"
      : share.publishState === "publishing"
        ? "Share publishing…"
        : share.snapshotCreatedAt !== null
          ? "Shared"
          : "Share waiting to publish";
  return subtitle ? `${subtitle} · ${note}` : note;
}

export function KnowledgeBasesListView() {
  const { agentsData, initialLoaded, rowProps, deleteAgent } = useAgentRows();
  const knowledgeBases = (agentsData?.list ?? []).filter(isKnowledgeBase);
  const shares = useKbShareList(knowledgeBases.length > 0);
  const shareByAgent = new Map((shares.data ?? []).map((s) => [s.agentId, s]));

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
        title="Knowledge base agents"
        description={
          knowledgeBases.length > 0
            ? "A knowledge base agent builds and maintains a wiki in its workspace. Open one to work with it in chat — ask questions and add to it."
            : undefined
        }
        actions={
          knowledgeBases.length > 0 ? (
            <Button onClick={createKnowledgeBase}>
              Create knowledge base agent
            </Button>
          ) : undefined
        }
      />

      {!initialLoaded && <ListSkeleton rows={2} rowHeight={70} />}

      {initialLoaded && (
        <OutdatedTemplatesBanner
          agents={knowledgeBases}
          noun="knowledge base agents"
        />
      )}

      {initialLoaded && knowledgeBases.length === 0 && (
        <PageEmptyState
          title="No knowledge base agents yet"
          message="A knowledge base agent builds and maintains a wiki you can chat with. Point it at a repo or docs, or add knowledge as you go. Create an agent with the knowledge base preset to get started."
          actionLabel="Create knowledge base agent"
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
                configureLabel="Configure knowledge base agent"
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
