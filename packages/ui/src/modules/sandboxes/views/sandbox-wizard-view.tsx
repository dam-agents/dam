import { useEffect, useMemo, useState } from "react";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import type { TemplateView } from "../../../types.js";
import { useCreateAgent } from "../../agents/api/mutations.js";
import { useTemplates } from "../../templates/api/queries.js";
import {
  EMPTY_REGISTRY_CREDENTIAL,
  registryFilledCount,
} from "../components/registry-credential-section.js";
import { SandboxWizardShell } from "../components/sandbox-wizard-shell.js";
import { ConnectionsStep } from "../components/steps/connections-step.js";
import { ImageStep } from "../components/steps/image-step.js";
import { SetupStep } from "../components/steps/setup-step.js";
import { useSandboxWizard } from "../hooks/use-sandbox-wizard.js";
import { loadSnapshot, type WizardStep } from "../lib/wizard-snapshot.js";

const NO_TEMPLATES: TemplateView[] = [];

export function SandboxWizardView() {
  const { snapshot, update, reset } = useSandboxWizard();
  const { data: templates, isLoading } = useTemplates();
  const createAgent = useCreateAgent();
  const selectAgent = useStore((s) => s.selectAgent);
  const templateList = templates ?? NO_TEMPLATES;

  // Pull credentials are secret, so they live here as ephemeral state — never
  // in the wizard snapshot, which is persisted to sessionStorage.
  const [registryCredential, setRegistryCredential] = useState(
    EMPTY_REGISTRY_CREDENTIAL,
  );
  const isCustomImage =
    !snapshot.templateId && snapshot.customImage.trim().length > 0;

  const imageLabel = useMemo(() => {
    if (snapshot.templateId)
      return (
        templateList.find((t) => t.id === snapshot.templateId)?.name ?? null
      );
    if (snapshot.customImage.trim()) return "Custom";
    return null;
  }, [snapshot.templateId, snapshot.customImage, templateList]);

  // Own the OAuth return here (app.tsx skips /sandboxes/new): select the
  // connection on success, drop it on failure, then strip the query params.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("oauth");
    if (!result) return;
    window.history.replaceState({}, "", "/sandboxes/new");
    const saved = loadSnapshot();
    const pending = saved.pendingConnectionId;
    if (result === "success" && pending) {
      update({
        pendingConnectionId: null,
        connectionIds: [...new Set([...saved.connectionIds, pending])],
      });
    } else {
      update({
        pendingConnectionId: null,
        ...(pending
          ? {
              connectionIds: saved.connectionIds.filter((id) => id !== pending),
            }
          : {}),
      });
      if (result !== "success")
        emitToast({
          kind: "error",
          message: `Connection authorization failed: ${params.get("message") ?? "unknown error"}`,
        });
    }
  }, [update]);

  const goToStep = (step: WizardStep) => update({ step });

  const finish = async () => {
    const image = snapshot.customImage.trim();
    const useRegistry =
      !!image && registryFilledCount(registryCredential) === 3;
    try {
      const agent = await createAgent.mutateAsync({
        name: snapshot.name.trim(),
        ...(image
          ? { image }
          : { templateId: snapshot.templateId ?? undefined }),
        egressPreset: snapshot.egressPreset,
        ...(snapshot.providerSecretId
          ? { secretIds: [snapshot.providerSecretId] }
          : {}),
        ...(snapshot.connectionIds.length
          ? { appConnectionIds: snapshot.connectionIds }
          : {}),
        ...(useRegistry
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
      selectAgent(agent.id);
    } catch {
      // Mutation surfaces its own error toast; stay on Step 3 to retry.
    }
  };

  return (
    <SandboxWizardShell
      step={snapshot.step}
      imageLabel={imageLabel}
      onNavigate={goToStep}
    >
      {snapshot.step === 1 && (
        <ImageStep
          templates={templateList}
          loading={isLoading}
          selectedTemplateId={snapshot.templateId}
          customImage={snapshot.customImage}
          onPickTemplate={(templateId) =>
            update({ templateId, customImage: "", step: 2 })
          }
          onCustomImageChange={(customImage) =>
            update({ customImage, templateId: null })
          }
          onContinueWithCustom={() => {
            if (snapshot.customImage.trim()) update({ step: 2 });
          }}
        />
      )}

      {snapshot.step === 2 && (
        <SetupStep
          name={snapshot.name}
          providerSecretId={snapshot.providerSecretId}
          egressPreset={snapshot.egressPreset}
          showRegistry={isCustomImage}
          registryCredential={registryCredential}
          onRegistryChange={setRegistryCredential}
          update={update}
          onContinue={() => update({ step: 3 })}
        />
      )}

      {snapshot.step === 3 && (
        <ConnectionsStep
          snapshot={snapshot}
          update={update}
          onFinish={finish}
          finishing={createAgent.isPending}
        />
      )}
    </SandboxWizardShell>
  );
}
