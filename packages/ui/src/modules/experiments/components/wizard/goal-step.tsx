import { useFormContext } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { ExperimentWizardValues } from "../../forms/experiment-wizard-schema.js";
import { WizardStepHeader } from "./wizard-step-header.js";

export function GoalStep() {
  const {
    register,
    formState: { errors },
  } = useFormContext<ExperimentWizardValues>();

  return (
    <div>
      <WizardStepHeader
        step={1}
        title="Set up the experiment"
        subtitle="Name the experiment and define the shared spec every arm receives."
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

        <div className="mt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Shared spec
          <span className="ml-1.5 font-normal normal-case tracking-normal">
            handed to every arm
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="exp-task">Task</Label>
          <Textarea
            id="exp-task"
            placeholder="Given a product review, output its sentiment. Optimize the prompt."
            {...register("task")}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-run-budget">Run budget</Label>
            <Input
              id="exp-run-budget"
              placeholder="50 runs"
              {...register("runBudget")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-time-budget">Time budget</Label>
            <Input
              id="exp-time-budget"
              placeholder="30 min"
              {...register("timeBudget")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
