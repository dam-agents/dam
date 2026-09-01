import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

import { useStore } from "../../../store.js";
import { useFeatures } from "../../features/api/queries.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { EMPTY_REGISTRY_CREDENTIAL } from "../../sandboxes/components/registry-credential-section.js";
import { ImageSection } from "../../sandboxes/components/setup/image-section.js";
import { SetupPageShell } from "../../sandboxes/components/setup/setup-page-shell.js";
import {
  ConnectionsSetupSection,
  NameSection,
  ProviderSection,
} from "../../sandboxes/components/setup/setup-sections.js";
import { useSetupForm } from "../../sandboxes/hooks/use-setup-form.js";
import {
  imageCatalogue,
  KINDED_HARNESS_TEMPLATE_ID,
} from "../../sandboxes/lib/image-catalogue.js";
import { setupProviderPolicy } from "../../sandboxes/lib/setup-policy.js";
import { ScheduleSetupSection } from "../../schedules/components/schedule-setup-section.js";
import { useTemplates } from "../../templates/api/queries.js";
import { useCreateAgent } from "../api/mutations.js";
import {
  type AgentSetupDraft,
  buildAgentSetupInput,
  hasPartialRegistryCredential,
  isAgentSetupComplete,
} from "../lib/create-agent-input.js";

const RETURN_PATH = routeToPath({ view: "agent-new" });

export function AgentSetupView() {
  const { form, update, reset } = useSetupForm("coding-agent", {}, RETURN_PATH);
  const { data: templates, isLoading } = useTemplates();
  const { data: flags } = useFeatures();
  const createAgent = useCreateAgent();
  const selectAgent = useStore((s) => s.selectAgent);
  const setView = useStore((s) => s.setView);

  const [registryCredential, setRegistryCredential] = useState(
    EMPTY_REGISTRY_CREDENTIAL,
  );
  const [registryDisclosureOverride, setRegistryDisclosureOverride] = useState<
    boolean | null
  >(null);

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
    preselected.current = true;
    if (form.templateId !== null || form.customImage.trim().length > 0) return;
    if (catalogue.harnesses.some((t) => t.id === KINDED_HARNESS_TEMPLATE_ID)) {
      update({ templateId: KINDED_HARNESS_TEMPLATE_ID });
    }
  }, [catalogue.harnesses, form.templateId, form.customImage, update]);

  const isPending = createAgent.isPending;

  const canCreate = (() => {
    if (isPending) return false;
    if (form.name.trim().length === 0 || form.providerRef === null)
      return false;
    const draft: AgentSetupDraft = {
      name: form.name,
      templateId: form.templateId,
      customImage: form.customImage,
      providerRef: form.providerRef,
      connectionIds: form.connectionIds,
      registryCredential,
    };
    return isAgentSetupComplete(draft);
  })();

  const registryPartial = hasPartialRegistryCredential({
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
      const draft: AgentSetupDraft = {
        name: form.name,
        templateId: form.templateId,
        customImage: form.customImage,
        providerRef: form.providerRef,
        connectionIds: form.connectionIds,
        registryCredential,
      };
      const agent = await createAgent.mutateAsync(buildAgentSetupInput(draft));
      reset();
      setRegistryCredential(EMPTY_REGISTRY_CREDENTIAL);
      setRegistryDisclosureOverride(null);
      selectAgent(agent.id);
    } catch {}
  };

  return (
    <SetupPageShell
      title="Create an agent"
      subtitle="Start from a pack, or configure it yourself."
      footer={
        <>
          {registryPartial && (
            <p className="text-sm text-destructive">
              Finish or clear the private-registry credentials.
            </p>
          )}
          <Button onClick={() => void create()} disabled={!canCreate}>
            {isPending ? "Creating…" : "Create agent"}
          </Button>
        </>
      }
    >
      <section className="mb-8">
        <Callout inset>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              A pack sets up the skills, schedules and connections for you.
            </p>
            <Button variant="outline" onClick={() => setView("packs")}>
              Start from a pack
            </Button>
          </div>
        </Callout>
      </section>

      <NameSection value={form.name} onChange={(name) => update({ name })} />
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
      <ScheduleSetupSection
        drafts={form.scheduleDrafts}
        onDraftsChange={(scheduleDrafts) => update({ scheduleDrafts })}
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
