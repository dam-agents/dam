import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";

import { useStore } from "../../../store.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { CardGrid } from "../../sandboxes/components/card-list.js";
import { HarnessGrid } from "../../sandboxes/components/setup/harness-grid.js";
import { SetupPageShell } from "../../sandboxes/components/setup/setup-page-shell.js";
import {
  ConnectionsSetupSection,
  NameSection,
  ProviderSection,
} from "../../sandboxes/components/setup/setup-sections.js";
import { KbTemplateCard } from "../../sandboxes/components/steps/kb-template-card.js";
import { useHarnessCatalogue } from "../../sandboxes/hooks/use-harness-catalogue.js";
import { useSetupForm } from "../../sandboxes/hooks/use-setup-form.js";
import { setupProviderPolicy } from "../../sandboxes/lib/setup-policy.js";
import { useCreateKnowledgeBase } from "../api/mutations.js";
import { ConnectedKnowledgeBasesSetup } from "../components/connected-knowledge-bases-setup.js";
import {
  buildKnowledgeBaseCreateInput,
  isKnowledgeBaseSetupComplete,
  type KnowledgeBaseSetupDraft,
} from "../lib/create-knowledge-base-input.js";
import { DEFAULT_KB_TEMPLATE_ID, KB_TEMPLATES } from "../lib/kb-templates.js";

const RETURN_PATH = routeToPath({ view: "knowledge-base-new" });

export function KnowledgeBaseSetupView() {
  const { form, update, toggleConnection, reset } = useSetupForm(
    "knowledge-base",
    { kbTemplateId: DEFAULT_KB_TEMPLATE_ID },
    RETURN_PATH,
  );
  const createKnowledgeBase = useCreateKnowledgeBase();
  const openKnowledgeBase = useStore((s) => s.openKnowledgeBase);

  const onTemplateIdChange = useCallback(
    (templateId: string | null) => update({ templateId }),
    [update],
  );
  const catalogue = useHarnessCatalogue({
    templateId: form.templateId,
    allowNone: false,
    onTemplateIdChange,
  });

  const draft: KnowledgeBaseSetupDraft = {
    name: form.name,
    templateId: form.templateId,
    kbTemplateId: form.kbTemplateId,
    providerRef: form.providerRef,
    connectionIds: form.connectionIds,
  };
  const canCreate =
    isKnowledgeBaseSetupComplete(draft) && !createKnowledgeBase.isPending;

  const create = async () => {
    if (!canCreate) return;
    try {
      const agent = await createKnowledgeBase.mutateAsync(
        buildKnowledgeBaseCreateInput(draft),
      );
      reset();
      openKnowledgeBase(agent.id);
    } catch {}
  };

  return (
    <SetupPageShell
      title="Setup your knowledge base agent"
      subtitle="Name your agent, choose a template and harness, select a provider, and add connections."
      footer={
        <Button onClick={() => void create()} disabled={!canCreate}>
          {createKnowledgeBase.isPending
            ? "Creating…"
            : "Create knowledge base agent"}
        </Button>
      }
    >
      <NameSection value={form.name} onChange={(name) => update({ name })} />

      <section className="mb-8">
        <SectionLabel spaced>Template</SectionLabel>
        <CardGrid>
          {KB_TEMPLATES.map((template) => (
            <KbTemplateCard
              key={template.id}
              template={template}
              selected={form.kbTemplateId === template.id}
              onSelect={() => update({ kbTemplateId: template.id })}
            />
          ))}
        </CardGrid>
      </section>

      <section className="mb-8">
        <SectionLabel spaced>Harness</SectionLabel>
        <HarnessGrid
          harnesses={catalogue.harnesses}
          loading={catalogue.isLoading}
          error={catalogue.isError}
          onRetry={catalogue.refetch}
          templateId={form.templateId}
          onPick={(templateId) => update({ templateId })}
        />
      </section>

      <ProviderSection
        selected={form.providerRef}
        onSelect={(providerRef) => update({ providerRef })}
        policy={setupProviderPolicy("knowledge-base")}
      />
      <ConnectionsSetupSection
        connectionIds={form.connectionIds}
        onToggle={toggleConnection}
        oauthReturnView={RETURN_PATH}
      />
      <ConnectedKnowledgeBasesSetup
        connectionIds={form.connectionIds}
        onToggle={toggleConnection}
      />
    </SetupPageShell>
  );
}
