import { useFormContext } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { ExperimentWizardValues } from "../../forms/experiment-wizard-schema.js";
import { WizardStepHeader } from "./wizard-step-header.js";

export function PromptStep() {
  const {
    register,
    formState: { errors },
  } = useFormContext<ExperimentWizardValues>();

  return (
    <div>
      <WizardStepHeader
        step={1}
        title="Set up the experiment"
        subtitle="Name the experiment and write the prompt every arm receives."
      />

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="exp-name">Name</Label>
          <Input
            id="exp-name"
            variant={errors.name ? "invalid" : "standard"}
            placeholder="Optimize prompt for sentiment classifier"
            {...register("name")}
          />
          {errors.name && (
            <p className="text-[12px] text-destructive">
              {errors.name.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="exp-prompt">Prompt</Label>
          <Textarea
            id="exp-prompt"
            placeholder="Given a product review, output its sentiment. Optimize the prompt."
            {...register("prompt")}
          />
          {errors.prompt && (
            <p className="text-[12px] text-destructive">
              {errors.prompt.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
