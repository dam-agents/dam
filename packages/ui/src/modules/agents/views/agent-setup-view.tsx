import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";

import { useStore } from "../../../store.js";
import { useCreateExperimentSandbox } from "../../experiments/api/mutations.js";
import { useFeatures } from "../../features/api/queries.js";
import { useCreateKnowledgeBase } from "../../knowledge-bases/api/mutations.js";
import {
  DEFAULT_KB_TEMPLATE_ID,
  KB_TEMPLATES,
} from "../../knowledge-bases/lib/kb-templates.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { CardGrid } from "../../sandboxes/components/card-list.js";
import { EMPTY_REGISTRY_CREDENTIAL } from "../../sandboxes/components/registry-credential-section.js";
import { ImageSection } from "../../sandboxes/components/setup/image-section.js";
import { SetupPageShell } from "../../sandboxes/components/setup/setup-page-shell.js";
import {
  ConnectionsSetupSection,
  NameSection,
  ProviderSection,
} from "../../sandboxes/components/setup/setup-sections.js";
import { KbTemplateCard } from "../../sandboxes/components/steps/kb-template-card.js";
import { useSetupForm } from "../../sandboxes/hooks/use-setup-form.js";
import {
  imageCatalogue,
  KINDED_HARNESS_TEMPLATE_ID,
} from "../../sandboxes/lib/image-catalogue.js";
import { setupProviderPolicy } from "../../sandboxes/lib/setup-policy.js";
import { useTemplates } from "../../templates/api/queries.js";
import { useCreateAgent } from "../api/mutations.js";
import {
  type AgentSetupType,
  AgentTypeSection,
} from "../components/agent-type-section.js";
import { FrameworkSection } from "../components/framework-section.js";
import {
  buildCodingAgentSetupInput,
  type CodingAgentSetupDraft,
  hasPartialRegistryCredential,
  isCodingAgentSetupComplete,
} from "../lib/create-agent-input.js";

const RETURN_PATH = routeToPath({ view: "agent-new" });

type Step = "type" | "config";

export function AgentSetupView() {
  const [step, setStep] = useState<Step>("type");
  const [agentType, setAgentType] = useState<AgentSetupType | null>(null);

  const setupFlow =
    agentType === "research"
      ? ("research" as const)
      : agentType === "assistant"
        ? ("assistant" as const)
        : agentType === "knowledge-base"
          ? ("knowledge-base" as const)
          : ("coding-agent" as const);

  const { form, update, reset } = useSetupForm(setupFlow, {}, RETURN_PATH);
  const { data: templates, isLoading } = useTemplates();
  const { data: flags } = useFeatures();
  const createAgent = useCreateAgent();
  const createKnowledgeBase = useCreateKnowledgeBase();
  const createExperimentSandbox = useCreateExperimentSandbox();
  const selectAgent = useStore((s) => s.selectAgent);
  const openKnowledgeBase = useStore((s) => s.openKnowledgeBase);

  const [registryCredential, setRegistryCredential] = useState(
    EMPTY_REGISTRY_CREDENTIAL,
  );
  const [registryDisclosureOverride, setRegistryDisclosureOverride] = useState<
    boolean | null
  >(null);
  const [frameworkId, setFrameworkId] = useState<string | null>(null);

  const catalogue = useMemo(
    () =>
      imageCatalogue(templates ?? [], {
        vmFeatureEnabled: flags?.["vm-sandboxes"] ?? false,
      }),
    [templates, flags],
  );

  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || catalogue.harnesses.length === 0) return;
    if (agentType !== "coding" && agentType !== "assistant") return;
    preselected.current = true;
    if (form.templateId !== null || form.customImage.trim().length > 0) return;
    if (catalogue.harnesses.some((t) => t.id === KINDED_HARNESS_TEMPLATE_ID)) {
      update({ templateId: KINDED_HARNESS_TEMPLATE_ID });
    }
  }, [
    catalogue.harnesses,
    form.templateId,
    form.customImage,
    update,
    agentType,
  ]);

  const isPending =
    createAgent.isPending ||
    createKnowledgeBase.isPending ||
    createExperimentSandbox.isPending;

  const canProceed = form.name.trim().length > 0 && agentType !== null;

  const canCreate = (() => {
    if (!agentType || isPending) return false;
    if (form.name.trim().length === 0 || form.providerRef === null)
      return false;

    if (agentType === "coding" || agentType === "assistant") {
      const draft: CodingAgentSetupDraft = {
        name: form.name,
        templateId: form.templateId,
        customImage: form.customImage,
        providerRef: form.providerRef,
        connectionIds: form.connectionIds,
        registryCredential,
      };
      return isCodingAgentSetupComplete(draft);
    }
    if (agentType === "research") return frameworkId !== null;
    if (agentType === "knowledge-base") return form.kbTemplateId !== null;
    return false;
  })();

  const registryPartial =
    (agentType === "coding" || agentType === "assistant") &&
    hasPartialRegistryCredential({
      name: form.name,
      templateId: form.templateId,
      customImage: form.customImage,
      providerRef: form.providerRef,
      connectionIds: form.connectionIds,
      registryCredential,
    });

  const create = async () => {
    if (!canCreate) return;
    try {
      if (agentType === "coding" || agentType === "assistant") {
        const draft: CodingAgentSetupDraft = {
          name: form.name,
          templateId: form.templateId,
          customImage: form.customImage,
          providerRef: form.providerRef,
          connectionIds: form.connectionIds,
          registryCredential,
        };
        const agent = await createAgent.mutateAsync(
          buildCodingAgentSetupInput(draft),
        );
        reset();
        setRegistryCredential(EMPTY_REGISTRY_CREDENTIAL);
        setRegistryDisclosureOverride(null);
        selectAgent(agent.id);
      } else if (agentType === "research") {
        const connectionIds = [
          ...new Set([
            ...form.connectionIds,
            ...(form.providerRef ? [form.providerRef.id] : []),
          ]),
        ];
        const agent = await createExperimentSandbox.mutateAsync({
          name: form.name.trim(),
          templateId: frameworkId ?? KINDED_HARNESS_TEMPLATE_ID,
          egressPreset: "trusted",
          ...(connectionIds.length ? { connectionIds } : {}),
        });
        reset();
        selectAgent(agent.id);
      } else if (agentType === "knowledge-base") {
        const connectionIds = [
          ...new Set([
            ...form.connectionIds,
            ...(form.providerRef ? [form.providerRef.id] : []),
          ]),
        ];
        const agent = await createKnowledgeBase.mutateAsync({
          name: form.name.trim(),
          templateId: form.templateId ?? KINDED_HARNESS_TEMPLATE_ID,
          kbTemplateId: form.kbTemplateId ?? DEFAULT_KB_TEMPLATE_ID,
          egressPreset: "trusted",
          ...(connectionIds.length ? { connectionIds } : {}),
        });
        reset();
        openKnowledgeBase(agent.id);
      }
    } catch {}
  };

  const handleTypeChange = (type: AgentSetupType) => {
    setAgentType(type);
    preselected.current = false;
    if (type === "knowledge-base") {
      update({
        templateId: KINDED_HARNESS_TEMPLATE_ID,
        kbTemplateId: DEFAULT_KB_TEMPLATE_ID,
        customImage: "",
      });
    } else if (type === "research") {
      update({
        templateId: KINDED_HARNESS_TEMPLATE_ID,
        customImage: "",
      });
    } else {
      update({ kbTemplateId: null });
    }
    setFrameworkId(null);
  };

  const buttonLabel = isPending
    ? "Creating…"
    : agentType === "knowledge-base"
      ? "Create knowledge base"
      : "Create agent";

  if (step === "type") {
    return (
      <SetupPageShell
        title="Setup your agent"
        subtitle="Name your agent and choose a type to get started."
        footer={
          <Button onClick={() => setStep("config")} disabled={!canProceed}>
            Next
          </Button>
        }
      >
        <NameSection value={form.name} onChange={(name) => update({ name })} />
        <AgentTypeSection selected={agentType} onSelect={handleTypeChange} />
      </SetupPageShell>
    );
  }

  return (
    <SetupPageShell
      title="Configure your agent"
      subtitle={`Set up ${agentType === "knowledge-base" ? "your knowledge base" : `your ${agentType ?? ""} agent`}.`}
      footer={
        <>
          {registryPartial && (
            <p className="text-sm text-destructive">
              Finish or clear the private-registry credentials.
            </p>
          )}
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep("type")}>
              Back
            </Button>
            <Button onClick={() => void create()} disabled={!canCreate}>
              {buttonLabel}
            </Button>
          </div>
        </>
      }
    >
      {(agentType === "coding" || agentType === "assistant") && (
        <ImageSection
          harnesses={catalogue.harnesses}
          loading={isLoading}
          templateId={form.templateId}
          customImage={form.customImage}
          registry={{
            value: registryCredential,
            onChange: setRegistryCredential,
            partial: registryPartial,
            disclosureOverride: registryDisclosureOverride,
            onDisclosureOverride: setRegistryDisclosureOverride,
          }}
          onPickTemplate={(templateId) =>
            update({ templateId, customImage: "" })
          }
          onCustomImageChange={(customImage) =>
            update({ customImage, templateId: null })
          }
          onSubmit={() => void create()}
        />
      )}

      {agentType === "research" && (
        <FrameworkSection
          frameworks={catalogue.preconfigured}
          loading={isLoading}
          selectedId={frameworkId}
          onSelect={setFrameworkId}
        />
      )}

      {agentType === "knowledge-base" && (
        <section className="mb-8">
          <SectionLabel spaced>Wiki type</SectionLabel>
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
      )}

      <ProviderSection
        selected={form.providerRef}
        onSelect={(providerRef) => update({ providerRef })}
        policy={setupProviderPolicy(setupFlow)}
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
