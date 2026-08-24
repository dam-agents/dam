import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { ConnectedKnowledgeBasesSetup } from "../../knowledge-bases/components/connected-knowledge-bases-setup.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { SetupPageShell } from "../../sandboxes/components/setup/setup-page-shell.js";
import {
  ConnectionsSetupSection,
  NameSection,
  ProviderSection,
} from "../../sandboxes/components/setup/setup-sections.js";
import { useSetupForm } from "../../sandboxes/hooks/use-setup-form.js";
import { KINDED_HARNESS_TEMPLATE_ID } from "../../sandboxes/lib/image-catalogue.js";
import { setupProviderPolicy } from "../../sandboxes/lib/setup-policy.js";
import { useCreateExperimentSandbox } from "../api/mutations.js";

const RETURN_PATH = routeToPath({ view: "experiment-new" });

export function ExperimentSetupView() {
  const { form, update, toggleConnection, reset } = useSetupForm(
    "experiment",
    { templateId: KINDED_HARNESS_TEMPLATE_ID },
    RETURN_PATH,
  );
  const createExperimentSandbox = useCreateExperimentSandbox();
  const selectAgent = useStore((s) => s.selectAgent);

  const canCreate =
    form.name.trim().length > 0 &&
    form.providerRef !== null &&
    !createExperimentSandbox.isPending;

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
      selectAgent(agent.id);
    } catch {}
  };

  return (
    <SetupPageShell
      title="Setup your experiment"
      subtitle="Name your experiment, choose a provider, and add connections."
      footer={
        <Button onClick={() => void create()} disabled={!canCreate}>
          {createExperimentSandbox.isPending
            ? "Creating…"
            : "Create experiment"}
        </Button>
      }
    >
      <NameSection value={form.name} onChange={(name) => update({ name })} />
      <ProviderSection
        selected={form.providerRef}
        onSelect={(providerRef) => update({ providerRef })}
        policy={setupProviderPolicy("experiment")}
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
