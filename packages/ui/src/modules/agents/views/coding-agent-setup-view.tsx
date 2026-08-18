import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useFeatures } from "../../features/api/queries.js";
import { routeToPath } from "../../platform/lib/routes.js";
import {
  EMPTY_REGISTRY_CREDENTIAL,
  registryFilledCount,
} from "../../sandboxes/components/registry-credential-section.js";
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
import { useTemplates } from "../../templates/api/queries.js";
import { useCreateAgent } from "../api/mutations.js";

const RETURN_PATH = routeToPath({ view: "coding-agent-new" });

export function CodingAgentSetupView() {
  const { form, update, reset } = useSetupForm("coding-agent", {}, RETURN_PATH);
  const { data: templates, isLoading } = useTemplates();
  const { data: flags } = useFeatures();
  const createAgent = useCreateAgent();
  const selectAgent = useStore((s) => s.selectAgent);

  const [registryCredential, setRegistryCredential] = useState(
    EMPTY_REGISTRY_CREDENTIAL,
  );
  const [registryDisclosureOverride, setRegistryDisclosureOverride] = useState<
    boolean | null
  >(null);

  const harnesses = useMemo(
    () =>
      imageCatalogue(templates ?? [], {
        vmFeatureEnabled: flags?.["vm-sandboxes"] ?? false,
      }).harnesses,
    [templates, flags],
  );

  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || isLoading) return;
    preselected.current = true;
    if (form.templateId !== null || form.customImage.trim().length > 0) return;
    if (harnesses.some((t) => t.id === KINDED_HARNESS_TEMPLATE_ID)) {
      update({ templateId: KINDED_HARNESS_TEMPLATE_ID });
    }
  }, [isLoading, harnesses, form.templateId, form.customImage, update]);

  const image = form.customImage.trim();
  const registryFilled = registryFilledCount(registryCredential);
  const registryPartial = registryFilled > 0 && registryFilled < 3;
  const canCreate =
    form.name.trim().length > 0 &&
    form.providerRef !== null &&
    (form.templateId !== null || image.length > 0) &&
    !registryPartial &&
    !createAgent.isPending;

  const create = async () => {
    if (!canCreate) return;
    const connectionIds = [
      ...form.connectionIds,
      ...(form.providerRef ? [form.providerRef.id] : []),
    ];
    try {
      const agent = await createAgent.mutateAsync({
        name: form.name.trim(),
        egressPreset: "trusted",
        ...(image ? { image } : { templateId: form.templateId ?? undefined }),
        ...(connectionIds.length ? { appConnectionIds: connectionIds } : {}),
        ...(image && registryFilled === 3
          ? {
              registryCredential: {
                server: registryCredential.server.trim(),
                username: registryCredential.username.trim(),
                password: registryCredential.password,
              },
            }
          : {}),
      });
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
        harnesses={harnesses}
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
