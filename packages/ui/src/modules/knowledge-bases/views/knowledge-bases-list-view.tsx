import { Button } from "@/components/ui/button";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { PageHeader } from "@/components/ui/page-header";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { AgentRow } from "../../agents/components/agent-row.js";
import { useAgentRows } from "../../agents/hooks/use-agent-rows.js";
import { isKnowledgeBase } from "../../agents/utils/agent-kind.js";
import { joinSubtitleSegments } from "../../agents/utils/sandbox-subtitle.js";
import { confirmDeleteKnowledgeBase } from "../lib/confirm-delete.js";
import { kbTemplateName } from "../lib/kb-templates.js";

/** The Knowledge Bases surface: the owner's agents carrying the
 *  `knowledge-base` kind. Rows open the standalone knowledge-base page — the
 *  knowledge base is worked with conversationally, not configured first. */
export function KnowledgeBasesListView() {
  const { agentsData, initialLoaded, rowProps, deleteAgent } = useAgentRows();
  const knowledgeBases = (agentsData?.list ?? []).filter(isKnowledgeBase);

  const openKnowledgeBase = useStore((s) => s.openKnowledgeBase);
  // Created in the shared wizard, entered with the KB starting point picked.
  const navigateToCreateSandbox = useStore((s) => s.navigateToCreateSandbox);
  const createKnowledgeBase = () => navigateToCreateSandbox("knowledge-base");
  const showConfirm = useStore((s) => s.showConfirm);

  const deleteKnowledgeBase = async (agent: AgentView) => {
    if (!(await confirmDeleteKnowledgeBase(showConfirm, agent.name))) return;
    deleteAgent.mutate({ id: agent.id });
  };

  return (
    <div className="mx-auto w-full max-w-[666px]">
      <PageHeader
        title="Knowledge bases"
        actions={
          knowledgeBases.length > 0 ? (
            <Button onClick={createKnowledgeBase}>New knowledge base</Button>
          ) : undefined
        }
      />

      {!initialLoaded && <ListSkeleton rows={2} rowHeight={70} />}

      {initialLoaded && knowledgeBases.length === 0 && (
        <PageEmptyState
          title="No knowledge bases yet"
          message="A knowledge base is an agent that builds and maintains a body of knowledge for you. Create one and it sets itself up."
          actionLabel="New knowledge base"
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
                // Lead the subtitle with the KB template (the installation
                // procedure) — the segment KBs are told apart by; harness and
                // provider follow. Omitted on KBs from before it was recorded.
                subtitle={joinSubtitleSegments([
                  kbTemplateName(agent.kbTemplateId),
                  props.subtitle,
                ])}
                onSelect={() => openKnowledgeBase(agent.id)}
                onDelete={() => void deleteKnowledgeBase(agent)}
              />
            );
          })}
      </div>
    </div>
  );
}
