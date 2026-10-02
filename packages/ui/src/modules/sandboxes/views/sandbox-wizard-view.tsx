import type { KnowledgeBaseTemplateId } from "api-server-api";
import { ArrowRight } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import type { TemplateView } from "../../../types.js";
import { useCreateAgent } from "../../agents/api/mutations.js";
import { useCreateExperimentSandbox } from "../../experiments/api/mutations.js";
import { useFeatures } from "../../features/api/queries.js";
import { useCreateKnowledgeBase } from "../../knowledge-bases/api/mutations.js";
import {
  DEFAULT_KB_TEMPLATE_ID,
  KB_TEMPLATES,
} from "../../knowledge-bases/lib/kb-templates.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { useTemplates } from "../../templates/api/queries.js";
import {
  EMPTY_REGISTRY_CREDENTIAL,
  registryFilledCount,
} from "../components/registry-credential-section.js";
import { SandboxWizardShell } from "../components/sandbox-wizard-shell.js";
import { ConnectionsStep } from "../components/steps/connections-step.js";
import { SetupStep } from "../components/steps/setup-step.js";
import { StartingPointStep } from "../components/steps/starting-point-step.js";
import { useSandboxWizard } from "../hooks/use-sandbox-wizard.js";
import { sizeToQuantities } from "../lib/quantity.js";
import { generateSandboxName } from "../lib/sandbox-name.js";
import {
  KINDED_HARNESS_TEMPLATE_ID,
  loadSnapshot,
  providerPolicy,
  type StartingPoint,
  startingPointComplete,
  type WizardStep,
} from "../lib/wizard-snapshot.js";

const NO_TEMPLATES: TemplateView[] = [];

/** Name what is actually being created. */
function createLabel(startingPoint: StartingPoint | null): string {
  if (startingPoint === "knowledge-base") return "Create knowledge base";
  if (startingPoint === "experiment") return "Create experiment sandbox";
  return "Create sandbox";
}

export function SandboxWizardView() {
  const { snapshot, update, reset } = useSandboxWizard();
  const { data: templates, isLoading } = useTemplates();
  const { data: flags } = useFeatures();
  const createAgent = useCreateAgent();
  const createKnowledgeBase = useCreateKnowledgeBase();
  const createExperimentSandbox = useCreateExperimentSandbox();
  const selectAgent = useStore((s) => s.selectAgent);
  const openKnowledgeBase = useStore((s) => s.openKnowledgeBase);
  const templateList = templates ?? NO_TEMPLATES;
  const creating =
    createAgent.isPending ||
    createKnowledgeBase.isPending ||
    createExperimentSandbox.isPending;

  // Pull credentials are secret, so they live here as ephemeral state — never
  // in the wizard snapshot, which is persisted to sessionStorage.
  const [registryCredential, setRegistryCredential] = useState(
    EMPTY_REGISTRY_CREDENTIAL,
  );
  const isCustomImage =
    !snapshot.templateId && snapshot.customImage.trim().length > 0;

  const imageLabel = useMemo(() => {
    // The image is pinned and hidden on these paths — name the kind instead.
    if (snapshot.startingPoint === "experiment") return "Experiment";
    if (snapshot.startingPoint === "knowledge-base") return "Knowledge base";
    if (snapshot.templateId)
      return (
        templateList.find((t) => t.id === snapshot.templateId)?.name ?? null
      );
    if (snapshot.customImage.trim()) return "Custom";
    return null;
  }, [
    snapshot.startingPoint,
    snapshot.templateId,
    snapshot.customImage,
    templateList,
  ]);

  // Own the OAuth return here (app.tsx skips /sandboxes/new): the popup flow
  // never leaves the page, so this only fires after a popup-blocked full-page
  // redirect — stage the authorized connection into the draft on success,
  // surface failures, then strip the query params.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("oauth");
    if (!result) return;
    window.history.replaceState({}, "", routeToPath({ view: "sandbox-new" }));
    const connectionId = params.get("connection");
    if (result === "success" && connectionId) {
      const saved = loadSnapshot();
      update({
        connectionIds: [...new Set([...saved.connectionIds, connectionId])],
      });
    } else if (result !== "success") {
      emitToast({
        kind: "error",
        message: `Connection authorization failed: ${params.get("message") ?? "unknown error"}`,
      });
    }
  }, [update]);

  useLayoutEffect(() => {
    if (snapshot.step === 2 && !snapshot.name.trim()) {
      update({ name: generateSandboxName() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.step]);

  const goToStep = (step: WizardStep) => update({ step });

  const registryFilled = registryFilledCount(registryCredential);
  const registryPartial =
    isCustomImage && registryFilled > 0 && registryFilled < 3;
  const step1CanAdvance = startingPointComplete(snapshot) && !registryPartial;
  const step2CanAdvance =
    snapshot.name.trim().length > 0 && snapshot.providerRef !== null;

  const finish = async () => {
    const image = snapshot.customImage.trim();
    const useRegistry =
      !!image && registryFilledCount(registryCredential) === 3;
    // Provider connections and catalog connections both grant the same way;
    // only the field name differs between the create paths.
    const connectionIds = [
      ...snapshot.connectionIds,
      ...(snapshot.providerRef ? [snapshot.providerRef.id] : []),
    ];
    const size = sizeToQuantities(snapshot.sizeCpuMilli, snapshot.sizeMemoryMi);
    const shared = {
      name: snapshot.name.trim(),
      ...(size ? { size } : {}),
      egressPreset: snapshot.egressPreset,
    };

    try {
      // The kinded paths go through their own module so the marker and its
      // Install Command land together.
      if (snapshot.startingPoint === "knowledge-base") {
        const agent = await createKnowledgeBase.mutateAsync({
          ...shared,
          // Pinned by startingPointDefaults; named so this doesn't depend on it.
          templateId: snapshot.templateId ?? KINDED_HARNESS_TEMPLATE_ID,
          kbTemplateId: snapshot.kbTemplateId ?? DEFAULT_KB_TEMPLATE_ID,
          ...(connectionIds.length ? { connectionIds } : {}),
        });
        reset();
        openKnowledgeBase(agent.id);
        return;
      }

      if (snapshot.startingPoint === "experiment") {
        const effectiveTemplate =
          snapshot.experimentTemplateId &&
          snapshot.experimentTemplateId !== "scratch"
            ? snapshot.experimentTemplateId
            : KINDED_HARNESS_TEMPLATE_ID;
        const agent = await createExperimentSandbox.mutateAsync({
          ...shared,
          templateId: effectiveTemplate,
          ...(connectionIds.length ? { connectionIds } : {}),
        });
        reset();
        selectAgent(agent.id);
        return;
      }

      const agent = await createAgent.mutateAsync({
        ...shared,
        ...(image
          ? { image }
          : { templateId: snapshot.templateId ?? undefined }),
        ...(connectionIds.length ? { appConnectionIds: connectionIds } : {}),
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

  const footer =
    snapshot.step === 1 ? (
      <Button onClick={() => update({ step: 2 })} disabled={!step1CanAdvance}>
        Continue <ArrowRight size={16} />
      </Button>
    ) : snapshot.step === 2 ? (
      <Button onClick={() => update({ step: 3 })} disabled={!step2CanAdvance}>
        Continue <ArrowRight size={16} />
      </Button>
    ) : (
      <>
        {registryPartial && (
          <button
            type="button"
            onClick={() => update({ step: 1 })}
            className="text-[13px] text-destructive underline underline-offset-2"
          >
            Finish the private-registry credentials on step 1
          </button>
        )}
        <Button onClick={finish} disabled={creating || registryPartial}>
          {creating ? "Creating…" : createLabel(snapshot.startingPoint)}
        </Button>
      </>
    );

  return (
    <SandboxWizardShell
      step={snapshot.step}
      maxStep={snapshot.maxStep || snapshot.step}
      imageLabel={imageLabel}
      onNavigate={goToStep}
      footer={footer}
    >
      {snapshot.step === 1 && (
        <StartingPointStep
          snapshot={snapshot}
          templates={templateList}
          loading={isLoading}
          registry={
            isCustomImage
              ? {
                  value: registryCredential,
                  onChange: setRegistryCredential,
                  partial: registryPartial,
                }
              : undefined
          }
          vmFeatureEnabled={flags?.["vm-sandboxes"] ?? false}
          kbTemplates={KB_TEMPLATES}
          onPickTemplate={(templateId) =>
            update({
              templateId,
              customImage: "",
              startingPoint: "general-purpose",
            })
          }
          onPickExperimentTemplate={(id) =>
            update({ experimentTemplateId: id })
          }
          onPickKbTemplate={(id) =>
            update({ kbTemplateId: id as KnowledgeBaseTemplateId })
          }
          onCustomImageChange={(customImage) =>
            update({ customImage, templateId: null, startingPoint: "custom" })
          }
          onContinue={() => {
            if (step1CanAdvance) update({ step: 2 });
          }}
        />
      )}

      {snapshot.step === 2 && (
        <SetupStep
          name={snapshot.name}
          providerRef={snapshot.providerRef}
          egressPreset={snapshot.egressPreset}
          update={update}
          setupNote={
            templateList.find((t) => t.id === snapshot.templateId)?.setupNote
          }
          templateSize={
            templateList.find((t) => t.id === snapshot.templateId)?.size
          }
          sizeCpuMilli={snapshot.sizeCpuMilli}
          sizeMemoryMi={snapshot.sizeMemoryMi}
          providers={providerPolicy(snapshot.startingPoint)}
          startingPoint={snapshot.startingPoint}
        />
      )}

      {snapshot.step === 3 && (
        <ConnectionsStep
          snapshot={snapshot}
          update={update}
          startingPoint={snapshot.startingPoint}
        />
      )}
    </SandboxWizardShell>
  );
}
