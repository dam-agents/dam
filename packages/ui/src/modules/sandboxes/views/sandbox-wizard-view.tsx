import { useMemo } from "react";

import { Button } from "@/components/ui/button";

import type { TemplateView } from "../../../types.js";
import { useTemplates } from "../../templates/api/queries.js";
import { SandboxWizardShell } from "../components/sandbox-wizard-shell.js";
import { StepHeader } from "../components/step-header.js";
import { ImageStep } from "../components/steps/image-step.js";
import { useSandboxWizard } from "../hooks/use-sandbox-wizard.js";
import type { WizardStep } from "../lib/wizard-snapshot.js";

// Stable fallback so `templateList`'s memo isn't defeated while the
// templates query has no data yet.
const NO_TEMPLATES: TemplateView[] = [];

export function SandboxWizardView() {
  const { snapshot, update } = useSandboxWizard();
  const { data: templates, isLoading } = useTemplates();
  const templateList = templates ?? NO_TEMPLATES;

  const imageLabel = useMemo(() => {
    if (snapshot.templateId)
      return (
        templateList.find((t) => t.id === snapshot.templateId)?.name ?? null
      );
    if (snapshot.customImage.trim()) return "Custom";
    return null;
  }, [snapshot.templateId, snapshot.customImage, templateList]);

  const goToStep = (step: WizardStep) => update({ step });

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
        <StepPlaceholder
          step={2}
          title="Setup your sandbox"
          subtitle="Name your sandbox, choose a provider, and set network permissions."
          onBack={() => goToStep(1)}
        />
      )}

      {snapshot.step === 3 && (
        <StepPlaceholder
          step={3}
          title="Grant connections"
          subtitle="Choose which app connections and credentials this sandbox can access."
          onBack={() => goToStep(2)}
        />
      )}
    </SandboxWizardShell>
  );
}

/** Temporary body for steps 2 and 3 until sub-issues 02 and 03 land. */
function StepPlaceholder({
  step,
  title,
  subtitle,
  onBack,
}: {
  step: WizardStep;
  title: string;
  subtitle: string;
  onBack: () => void;
}) {
  return (
    <div>
      <StepHeader step={step} title={title} subtitle={subtitle} />
      <p className="text-[14px] text-muted-foreground">
        Coming in sub-issue {String(step).padStart(2, "0")}.
      </p>
      <Button variant="outline" className="mt-6" onClick={onBack}>
        Back
      </Button>
    </div>
  );
}
