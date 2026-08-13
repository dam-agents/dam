import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useDemoState } from "../../../mock/demo-state.js";
import { protoNavigate } from "../../../mock/proto-navigate.js";
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
  const showConfirm = useStore((s) => s.showConfirm);
  const { state: demoState } = useDemoState();

  const goToSetup = () => {
    protoNavigate("/kb-setup");
  };

  if (import.meta.env.VITE_MOCK && demoState === "empty") {
    return <KnowledgeBasesEmptyState onCreate={goToSetup} />;
  }

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
          actions={<Button onClick={goToSetup}>Create knowledge base</Button>}
        />
      )}

      {!initialLoaded && <ListSkeleton rows={2} rowHeight={70} />}

      {initialLoaded && knowledgeBases.length === 0 && (
        <KnowledgeBasesEmptyState onCreate={goToSetup} />
      )}

      <div className="flex flex-col gap-3">
        {initialLoaded &&
          knowledgeBases.map((agent) => (
            <AgentRow
              key={agent.id}
              {...rowProps(agent)}
              hideKindBadge
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
    <div className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-8 anim-in">
      <h2 className="text-[20px] font-semibold text-foreground">
        Knowledge bases
      </h2>
      <p className="mt-2 max-w-[480px] text-[14px] leading-relaxed text-muted-foreground">
        Organize and converse with data sourced from repos, documents, and more
        (LLM wiki).
      </p>
      <Button className="mt-6" onClick={onCreate}>
        Create knowledge base
      </Button>
    </div>
  );
}
