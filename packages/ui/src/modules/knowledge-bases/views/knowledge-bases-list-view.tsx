import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  const navigateToCreateKnowledgeBase = useStore(
    (s) => s.navigateToCreateKnowledgeBase,
  );
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
