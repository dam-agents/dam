import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useFeatures } from "../../features/api/queries.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { openBindModal } from "../../sandboxes/components/channels/bind-modal-state.js";
import { EMPTY_REGISTRY_CREDENTIAL } from "../../sandboxes/components/registry-credential-section.js";
import {
  type Destination,
  DestinationSection,
} from "../../sandboxes/components/setup/destination-section.js";
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
import { markChannelIntent } from "../../slack/lib/channel-intent.js";
import { useTemplates } from "../../templates/api/queries.js";
import { useCreateExperimentSandbox } from "../api/mutations.js";

const RETURN_PATH = routeToPath({ view: "experiment-new" });
const DOCS_MAINTAINER_TEMPLATE_ID = "docs-maintainer";

export function ExperimentSetupView() {
  const [destinations, setDestinations] = useState<Destination[]>(["platform"]);

  const { form, update, reset } = useSetupForm(
    "experiment",
    { templateId: DOCS_MAINTAINER_TEMPLATE_ID },
    RETURN_PATH,
  );
  const { data: templates, isLoading } = useTemplates();
  const { data: flags } = useFeatures();
  const createExperimentSandbox = useCreateExperimentSandbox();
  const selectAgent = useStore((s) => s.selectAgent);

  const harnesses = useMemo(
    () =>
      imageCatalogue(templates ?? [], {
        vmFeatureEnabled: flags?.["vm-sandboxes"] ?? false,
      }).harnesses,
    [templates, flags],
  );

  const canCreate =
    form.name.trim().length > 0 &&
    form.providerRef !== null &&
    !createExperimentSandbox.isPending;

  function handleDestinationToggle(d: Destination) {
    setDestinations((prev) => {
      if (d === "platform") return ["platform"];
      const messengers = prev.filter(
        (x): x is "slack" | "telegram" => x !== "platform",
      );
      const has = messengers.includes(d as "slack" | "telegram");
      const next = has
        ? messengers.filter((x) => x !== d)
        : [...messengers, d as "slack" | "telegram"];
      return next.length === 0 ? ["platform"] : next;
    });
  }

  const create = async () => {
    if (!canCreate) return;
    const connectionIds = [
      ...new Set([
        ...form.connectionIds,
        ...(form.providerRef ? [form.providerRef.id] : []),
      ]),
    ];
    try {
      const agent = await createExperimentSandbox.mutateAsync({
        name: form.name.trim(),
        templateId: form.templateId ?? KINDED_HARNESS_TEMPLATE_ID,
        egressPreset: "trusted",
        ...(connectionIds.length ? { connectionIds } : {}),
      });
      reset();

      const messengerChannels = destinations.filter(
        (d): d is "slack" | "telegram" => d !== "platform",
      );

      selectAgent(agent.id);

      if (messengerChannels.length > 0) {
        for (const kind of messengerChannels) {
          markChannelIntent(agent.id, kind);
        }
        openBindModal(messengerChannels);
      }
    } catch {}
  };

  return (
    <SetupPageShell
      title="Setup your experiment"
      subtitle="Name your experiment, choose an image, select a provider, and add connections."
      footer={
        <Button onClick={() => void create()} disabled={!canCreate}>
          {createExperimentSandbox.isPending
            ? "Creating…"
            : "Create experiment"}
        </Button>
      }
    >
      <NameSection value={form.name} onChange={(name) => update({ name })} />

      <ImageSection
        harnesses={harnesses}
        loading={isLoading}
        templateId={form.templateId}
        customImage={form.customImage}
        registry={{
          value: EMPTY_REGISTRY_CREDENTIAL,
          onChange: () => {},
          partial: false,
          disclosureOverride: null,
          onDisclosureOverride: () => {},
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
        policy={setupProviderPolicy("experiment")}
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
      <DestinationSection
        selected={destinations}
        onToggle={handleDestinationToggle}
      />
    </SetupPageShell>
  );
}
