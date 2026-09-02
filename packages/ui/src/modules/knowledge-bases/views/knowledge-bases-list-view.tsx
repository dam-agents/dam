import { useState } from "react";

import { ListSkeleton } from "@/components/list-skeleton";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { CARD_HOVER, CARD_SURFACE } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { AgentRow } from "../../agents/components/agent-row.js";
import { OutdatedTemplatesBanner } from "../../agents/components/outdated-templates-banner.js";
import { useAgentRows } from "../../agents/hooks/use-agent-rows.js";
import { isKnowledgeBase } from "../../agents/utils/agent-kind.js";
import { KbIntentDetailSheet } from "../components/kb-intent-detail-sheet.js";
import { confirmDeleteKnowledgeBase } from "../lib/confirm-delete.js";
import { getExampleForIntent } from "../lib/kb-examples.js";
import { KB_INTENTS, type KbIntent } from "../lib/kb-intents.js";

export function KnowledgeBasesListView() {
  const { agentsData, initialLoaded, rowProps, deleteAgent } = useAgentRows();
  const knowledgeBases = (agentsData?.list ?? []).filter(isKnowledgeBase);
  const [selectedIntent, setSelectedIntent] = useState<KbIntent | null>(null);

  const openKnowledgeBase = useStore((s) => s.openKnowledgeBase);
  const navigateToKnowledgeBaseConfig = useStore(
    (s) => s.navigateToKnowledgeBaseConfig,
  );
  const setView = useStore((s) => s.setView);
  const showConfirm = useStore((s) => s.showConfirm);

  const handleCreateFromIntent = (intent: KbIntent) => {
    setSelectedIntent(null);
    useStore.getState().setPendingKbIntent(intent);
    setView("knowledge-base-new");
  };

  const handleTryExample = (intent: KbIntent) => {
    setSelectedIntent(null);
    const example = getExampleForIntent();
    const agentId = `demo-kb-${example.name}`;
    useStore.getState().setDemoKb(intent.id, agentId);
    openKnowledgeBase(agentId);
  };

  const deleteKnowledgeBase = async (agent: AgentView) => {
    if (!(await confirmDeleteKnowledgeBase(showConfirm, agent.name))) return;
    deleteAgent.mutate({ id: agent.id });
  };

  const hasKnowledgeBases = knowledgeBases.length > 0;

  return (
    <>
      <PageHeader
        title="Knowledge bases"
        description="A knowledge base builds and maintains a wiki you can chat with. Pick a starting point or create one from scratch."
        actions={
          hasKnowledgeBases ? (
            <Button onClick={() => setView("knowledge-base-new")}>
              Create knowledge base
            </Button>
          ) : undefined
        }
      />

      <section className="mb-8">
        <SectionLabel spaced>Start with an intent</SectionLabel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {KB_INTENTS.map((intent) => (
            <IntentCard
              key={intent.id}
              intent={intent}
              onSelect={() => setSelectedIntent(intent)}
            />
          ))}
        </div>
      </section>

      {!hasKnowledgeBases && initialLoaded && (
        <section className="mb-8">
          <Callout tone="muted" inset>
            <div className="flex items-center justify-between gap-4 py-2">
              <div>
                <p className="text-sm font-medium text-foreground">
                  See it in action
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Try an example knowledge base built from a real codebase.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const repoIntent = KB_INTENTS[0];
                  if (repoIntent) handleTryExample(repoIntent);
                }}
              >
                Try an example
              </Button>
            </div>
          </Callout>
        </section>
      )}

      {!initialLoaded && <ListSkeleton rows={2} rowHeight={70} />}

      {initialLoaded && (
        <OutdatedTemplatesBanner
          agents={knowledgeBases}
          noun="knowledge bases"
        />
      )}

      {hasKnowledgeBases && (
        <section>
          <SectionLabel spaced>Your knowledge bases</SectionLabel>
          <div className="flex flex-col gap-3">
            {knowledgeBases.map((agent) => (
              <AgentRow
                key={agent.id}
                {...rowProps(agent)}
                onSelect={() => openKnowledgeBase(agent.id)}
                onConfigure={() => navigateToKnowledgeBaseConfig(agent.id)}
                configureLabel="Configure knowledge base"
                onDelete={() => void deleteKnowledgeBase(agent)}
              />
            ))}
          </div>
        </section>
      )}

      <KbIntentDetailSheet
        intent={selectedIntent}
        onClose={() => setSelectedIntent(null)}
        onCreateFromIntent={handleCreateFromIntent}
        onTryExample={handleTryExample}
      />
    </>
  );
}

function IntentCard({
  intent,
  onSelect,
}: {
  intent: KbIntent;
  onSelect: () => void;
}) {
  const Icon = intent.icon;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        CARD_SURFACE,
        CARD_HOVER,
        "flex flex-col overflow-hidden p-5 text-left",
      )}
    >
      <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
        <Icon size={16} className="text-foreground" />
      </div>
      <h4 className="mt-3 text-sm font-semibold text-foreground">
        {intent.title}
      </h4>
      <p className="mt-1 flex-1 text-sm leading-relaxed text-muted-foreground">
        {intent.tagline}
      </p>
    </button>
  );
}
