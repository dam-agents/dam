import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { sizeInMi } from "../../budgets/lib/slots.js";
import { ConnectedKnowledgeBasesSetup } from "../../knowledge-bases/components/connected-knowledge-bases-setup.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { EMPTY_REGISTRY_CREDENTIAL } from "../../sandboxes/components/registry-credential-section.js";
import { ImageSection } from "../../sandboxes/components/setup/image-section.js";
import { SetupPageShell } from "../../sandboxes/components/setup/setup-page-shell.js";
import {
  ConnectionsSetupSection,
  LifecycleSetupSection,
  NameSection,
  ProviderSection,
} from "../../sandboxes/components/setup/setup-sections.js";
import { useHarnessCatalogue } from "../../sandboxes/hooks/use-harness-catalogue.js";
import { useSetupForm } from "../../sandboxes/hooks/use-setup-form.js";
import { setupProviderPolicy } from "../../sandboxes/lib/setup-policy.js";
import { useCreateAgent } from "../api/mutations.js";
import {
  buildCodingAgentSetupInput,
  type CodingAgentSetupDraft,
  hasPartialRegistryCredential,
  isCodingAgentSetupComplete,
} from "../lib/create-agent-input.js";

const RETURN_PATH = routeToPath({ view: "coding-agent-new" });

export function CodingAgentSetupView() {
  const { form, update, toggleConnection, reset } = useSetupForm(
    "coding-agent",
    {},
    RETURN_PATH,
  );
  const createAgent = useCreateAgent();
  const selectAgent = useStore((s) => s.selectAgent);

  const [registryCredential, setRegistryCredential] = useState(
    EMPTY_REGISTRY_CREDENTIAL,
  );
  const [registryDisclosureOverride, setRegistryDisclosureOverride] = useState<
    boolean | null
  >(null);

  const onTemplateIdChange = useCallback(
    (templateId: string | null) => update({ templateId }),
    [update],
  );
  const catalogue = useHarnessCatalogue({
    templateId: form.templateId,
    allowNone: form.customImage.trim().length > 0,
    onTemplateIdChange,
  });

  const draft: CodingAgentSetupDraft = {
    name: form.name,
    templateId: form.templateId,
    customImage: form.customImage,
    providerRef: form.providerRef,
    connectionIds: form.connectionIds,
    registryCredential,
    hibernationTimeoutMin: form.hibernationTimeoutMin,
  };
  const selectedTemplate = catalogue.harnesses.find(
    (t) => t.id === form.templateId,
  );
  const registryPartial = hasPartialRegistryCredential(draft);
  const canCreate = isCodingAgentSetupComplete(draft) && !createAgent.isPending;

  const create = async () => {
    if (!canCreate) return;
    try {
      const agent = await createAgent.mutateAsync(
        buildCodingAgentSetupInput(draft),
      );
      reset();
      setRegistryCredential(EMPTY_REGISTRY_CREDENTIAL);
      setRegistryDisclosureOverride(null);
      selectAgent(agent.id);
    } catch {}
  };

  return (
    <SetupPageShell
      title="Setup your coding agent"
      subtitle="Name your agent, choose an image, select a provider, and add connections."
      footer={
        <>
          {registryPartial && (
            <p className="text-sm text-destructive">
              Finish or clear the private-registry credentials.
            </p>
          )}
          <Button onClick={() => void create()} disabled={!canCreate}>
            {createAgent.isPending ? "Creating…" : "Create coding agent"}
          </Button>
        </>
      }
    >
      <NameSection value={form.name} onChange={(name) => update({ name })} />

      <ImageSection
        harnesses={catalogue.harnesses}
        loading={catalogue.isLoading}
        error={catalogue.isError}
        onRetry={catalogue.refetch}
        templateId={form.templateId}
        customImage={form.customImage}
        registry={{
          value: registryCredential,
          onChange: setRegistryCredential,
          partial: registryPartial,
          disclosureOverride: registryDisclosureOverride,
          onDisclosureOverride: setRegistryDisclosureOverride,
        }}
        onPickTemplate={(templateId) => update({ templateId, customImage: "" })}
        onCustomImageChange={(customImage) =>
          update({ customImage, templateId: null })
        }
        onSubmit={() => void create()}
      />

      <ProviderSection
        selected={form.providerRef}
        onSelect={(providerRef) => update({ providerRef })}
        policy={setupProviderPolicy("coding-agent")}
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
      <LifecycleSetupSection
        value={form.hibernationTimeoutMin}
        onChange={(hibernationTimeoutMin) => update({ hibernationTimeoutMin })}
        sizeMi={
          selectedTemplate?.size ? sizeInMi(selectedTemplate.size) : undefined
        }
      />
    </SetupPageShell>
  );
}
