import { Close } from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import {
  useAddArm,
  useCreateExperiment,
  useStartExperiment,
} from "../api/mutations.js";
import { ArmsStep } from "../components/wizard/arms-step.js";
import { PromptStep } from "../components/wizard/prompt-step.js";
import { ReviewStep } from "../components/wizard/review-step.js";
import { WizardStepIndicator } from "../components/wizard/wizard-step-indicator.js";
import {
  experimentWizardSchema,
  type ExperimentWizardValues,
} from "../forms/experiment-wizard-schema.js";

const STEP_FIELDS: Record<number, (keyof ExperimentWizardValues)[]> = {
  0: ["name", "prompt"],
  1: ["arms"],
};

export function ExperimentWizardView() {
  const navigateToExperiments = useStore((s) => s.navigateToExperiments);
  const navigateToExperiment = useStore((s) => s.navigateToExperiment);
  const createExperiment = useCreateExperiment();
  const addArm = useAddArm();
  const startExperiment = useStartExperiment();

  const form = useForm<ExperimentWizardValues>({
    resolver: zodResolver(experimentWizardSchema),
    mode: "onBlur",
    defaultValues: {
      name: "",
      prompt: "",
      arms: [],
    },
  });

  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const pending =
    createExperiment.isPending || addArm.isPending || startExperiment.isPending;

  async function goNext() {
    const valid = await form.trigger(STEP_FIELDS[step]);
    if (!valid) return;
    const target = step + 1;
    setStep(target);
    setMaxStep((current) => Math.max(current, target));
  }

  async function submit(startAfter: boolean) {
    if (!(await form.trigger())) return;
    const values = form.getValues();
    try {
      const created = await createExperiment.mutateAsync({
        name: values.name,
        prompt: values.prompt,
      });
      for (const arm of values.arms) {
        await addArm.mutateAsync({
          experimentId: created.id,
          agentId: arm.agentId,
          armVariation: arm.variation,
        });
      }
      if (startAfter) await startExperiment.mutateAsync({ id: created.id });
      emitToast({
        kind: "success",
        message: startAfter ? "Experiment started." : "Draft created.",
      });
      navigateToExperiment(created.id);
    } catch {
      // The mutations carry meta.errorToast, which surfaces the failure.
    }
  }

  return (
    <FormProvider {...form}>
      <div className="flex min-h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <span className="text-[15px] font-medium text-foreground">
            Create an experiment
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={navigateToExperiments}
            aria-label="Close"
          >
            <Close size={18} />
          </Button>
        </div>

        <div className="mx-auto flex w-full max-w-[920px] flex-1 flex-col gap-6 px-4 py-8 md:flex-row md:gap-10 md:px-8">
          <WizardStepIndicator
            step={step}
            maxStep={maxStep}
            onNavigate={setStep}
          />
          <div className="min-w-0 flex-1 md:max-w-[640px]">
            {step === 0 ? (
              <PromptStep />
            ) : step === 1 ? (
              <ArmsStep />
            ) : (
              <ReviewStep />
            )}
          </div>
        </div>

        <div className="sticky bottom-0 border-t border-border bg-background px-6 py-4">
          <div className="mx-auto flex w-full max-w-[920px] items-center justify-between">
            <Button
              variant="ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0 || pending}
            >
              Back
            </Button>
            <div className="flex items-center gap-2">
              {step < 2 ? (
                <Button onClick={goNext}>Continue</Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => void submit(false)}
                    disabled={pending}
                  >
                    Create draft
                  </Button>
                  <Button onClick={() => void submit(true)} disabled={pending}>
                    Create & Start
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </FormProvider>
  );
}
