import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";

import { useStore } from "../../../store.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { CardList } from "../../sandboxes/components/card-list.js";
import { SetupPageShell } from "../../sandboxes/components/setup/setup-page-shell.js";
import {
  ConnectionsSetupSection,
  NameSection,
  ProviderSection,
} from "../../sandboxes/components/setup/setup-sections.js";
import { KbTemplateCard } from "../../sandboxes/components/steps/kb-template-card.js";
import { useSetupForm } from "../../sandboxes/hooks/use-setup-form.js";
import { KINDED_HARNESS_TEMPLATE_ID } from "../../sandboxes/lib/image-catalogue.js";
import { setupProviderPolicy } from "../../sandboxes/lib/setup-policy.js";
import { useCreateKnowledgeBase } from "../api/mutations.js";
import { DEFAULT_KB_TEMPLATE_ID, KB_TEMPLATES } from "../lib/kb-templates.js";

const RETURN_PATH = routeToPath({ view: "knowledge-base-new" });

export function KnowledgeBaseSetupView() {
  const { form, update, reset } = useSetupForm(
    "knowledge-base",
    {
      templateId: KINDED_HARNESS_TEMPLATE_ID,
      kbTemplateId: DEFAULT_KB_TEMPLATE_ID,
    },
    RETURN_PATH,
  );
  const createKnowledgeBase = useCreateKnowledgeBase();
  const openKnowledgeBase = useStore((s) => s.openKnowledgeBase);

  const canCreate =
    form.name.trim().length > 0 &&
    form.providerRef !== null &&
    form.kbTemplateId !== null &&
    !createKnowledgeBase.isPending;

  const create = async () => {
    const connectionIds = [
      ...form.connectionIds,
      ...(form.providerRef ? [form.providerRef.id] : []),
    ];
    try {
      const agent = await createKnowledgeBase.mutateAsync({
        name: form.name.trim(),
        templateId: form.templateId ?? KINDED_HARNESS_TEMPLATE_ID,
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
      title="Setup your knowledge base"
      subtitle="Name your knowledge base, choose a template, and add connections."
      footer={
        <Button onClick={() => void create()} disabled={!canCreate}>
          {createKnowledgeBase.isPending
            ? "Creating…"
            : "Create knowledge base"}
        </Button>
      }
    >
      <NameSection value={form.name} onChange={(name) => update({ name })} />

      <section className="mb-8">
        <SectionLabel spaced>Template</SectionLabel>
        <CardList>
          {KB_TEMPLATES.map((template) => (
            <KbTemplateCard
              key={template.id}
              template={template}
              selected={form.kbTemplateId === template.id}
              onSelect={() => update({ kbTemplateId: template.id })}
            />
          ))}
        </CardList>
      </section>

      <ProviderSection
        selected={form.providerRef}
        onSelect={(providerRef) => update({ providerRef })}
        policy={setupProviderPolicy("knowledge-base")}
      />
      <ConnectionsSetupSection
        connectionIds={form.connectionIds}
        onToggle={(id, granted) =>
          update({
            connectionIds: granted
              ? [...new Set([...form.connectionIds, id])]
              : form.connectionIds.filter((x) => x !== id),
          })
        }
        oauthReturnView={RETURN_PATH}
      />
    </SetupPageShell>
  );
}
