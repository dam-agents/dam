import { useEffect, useMemo, useRef } from "react";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { useFeatures } from "../../features/api/queries.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { CardGrid, CardList } from "../../sandboxes/components/card-list.js";
import { SetupPageShell } from "../../sandboxes/components/setup/setup-page-shell.js";
import {
  ConnectionsSetupSection,
  NameSection,
  ProviderSection,
} from "../../sandboxes/components/setup/setup-sections.js";
import { HarnessCard } from "../../sandboxes/components/steps/harness-card.js";
import { KbTemplateCard } from "../../sandboxes/components/steps/kb-template-card.js";
import { useSetupForm } from "../../sandboxes/hooks/use-setup-form.js";
import {
  imageCatalogue,
  KINDED_HARNESS_TEMPLATE_ID,
} from "../../sandboxes/lib/image-catalogue.js";
import { setupProviderPolicy } from "../../sandboxes/lib/setup-policy.js";
import { useTemplates } from "../../templates/api/queries.js";
import { useCreateKnowledgeBase } from "../api/mutations.js";
import { ConnectedKnowledgeBasesSetup } from "../components/connected-knowledge-bases-setup.js";
import { DEFAULT_KB_TEMPLATE_ID, KB_TEMPLATES } from "../lib/kb-templates.js";

const RETURN_PATH = routeToPath({ view: "knowledge-base-new" });

export function KnowledgeBaseSetupView() {
  const { form, update, toggleConnection, reset } = useSetupForm(
    "knowledge-base",
    { kbTemplateId: DEFAULT_KB_TEMPLATE_ID },
    RETURN_PATH,
  );
  const { data: templates, isLoading } = useTemplates();
  const { data: flags } = useFeatures();
  const createKnowledgeBase = useCreateKnowledgeBase();
  const openKnowledgeBase = useStore((s) => s.openKnowledgeBase);

  const harnesses = useMemo(
    () =>
      imageCatalogue(templates ?? [], {
        vmFeatureEnabled: flags?.["vm-sandboxes"] ?? false,
      }).harnesses,
    [templates, flags],
  );
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || harnesses.length === 0) return;
    preselected.current = true;
    if (form.templateId !== null) return;
    if (harnesses.some((t) => t.id === KINDED_HARNESS_TEMPLATE_ID)) {
      update({ templateId: KINDED_HARNESS_TEMPLATE_ID });
    }
  }, [harnesses, form.templateId, update]);

  const canCreate =
    form.name.trim().length > 0 &&
    form.providerRef !== null &&
    form.kbTemplateId !== null &&
    harnesses.some((t) => t.id === form.templateId) &&
    !createKnowledgeBase.isPending;

  const create = async () => {
    if (!canCreate || form.templateId === null) return;
    const connectionIds = [
      ...new Set([
        ...form.connectionIds,
        ...(form.providerRef ? [form.providerRef.id] : []),
      ]),
    ];
    try {
      const agent = await createKnowledgeBase.mutateAsync({
        name: form.name.trim(),
        templateId: form.templateId,
        kbTemplateId: form.kbTemplateId ?? DEFAULT_KB_TEMPLATE_ID,
        egressPreset: "trusted",
        ...(connectionIds.length ? { connectionIds } : {}),
      });
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
        {isLoading ? (
          <CardList>
            <ListSkeleton rows={2} rowHeight={156} />
          </CardList>
        ) : (
          <CardGrid>
            {harnesses.map((template) => (
              <HarnessCard
                key={template.id}
                template={template}
                selected={template.id === form.templateId}
                onSelect={() => update({ templateId: template.id })}
              />
            ))}
          </CardGrid>
        )}
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
