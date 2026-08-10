import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { AgentRow } from "../../agents/components/agent-row.js";
import { useAgentRows } from "../../agents/hooks/use-agent-rows.js";
import { isKnowledgeBase } from "../../agents/utils/agent-kind.js";
import { confirmDeleteKnowledgeBase } from "../lib/confirm-delete.js";

export function KnowledgeBasesListView() {
  const { agentsData, initialLoaded, rowProps, deleteAgent } = useAgentRows();
  const knowledgeBases = (agentsData?.list ?? []).filter(isKnowledgeBase);

  const openKnowledgeBase = useStore((s) => s.openKnowledgeBase);
  const navigateToCreateSandbox = useStore((s) => s.navigateToCreateSandbox);
  const showConfirm = useStore((s) => s.showConfirm);

  const deleteKb = async (agent: AgentView) => {
    if (!(await confirmDeleteKnowledgeBase(showConfirm, agent.name))) return;
    deleteAgent.mutate({ id: agent.id });
  };

  return (
    <div>
      {initialLoaded && knowledgeBases.length > 0 && (
        <PageHeader
          title="Knowledge bases"
          description="A knowledge base builds and maintains a wiki in its workspace. Open one to chat — ask questions, add context, and let it grow."
          actions={
            <Button
              onClick={() => navigateToCreateSandbox("knowledge-base")}
            >
              Create knowledge base
            </Button>
          }
        />
      )}

      {!initialLoaded && <ListSkeleton rows={2} rowHeight={70} />}

      {initialLoaded && knowledgeBases.length === 0 && (
        <KnowledgeBasesEmptyState
          onCreate={() => navigateToCreateSandbox("knowledge-base")}
        />
      )}

      <div className="flex flex-col gap-3">
        {initialLoaded &&
          knowledgeBases.map((agent) => (
            <AgentRow
              key={agent.id}
              {...rowProps(agent)}
              onSelect={() => openKnowledgeBase(agent.id)}
              onDelete={() => void deleteKb(agent)}
            />
          ))}
      </div>
    </div>
  );
}

function KnowledgeBasesEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-border py-16 text-center anim-in">
      <h2 className="text-[20px] font-semibold text-foreground">
        Knowledge bases
      </h2>
      <p className="mt-2 max-w-[480px] text-[14px] leading-relaxed text-muted-foreground">
        A knowledge base builds and maintains a wiki from your repos, docs, or
        conversations. Create one and choose how it organizes information.
      </p>
      <Button className="mt-6" onClick={onCreate}>
        Create knowledge base
      </Button>
    </div>
  );
}
