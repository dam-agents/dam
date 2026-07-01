import { useFormContext, useWatch } from "react-hook-form";

import type { ExperimentWizardValues } from "../../forms/experiment-wizard-schema.js";
import { useAgentLabels } from "../../hooks/use-agent-labels.js";
import { armColor } from "../../lib/arm-color.js";
import { WizardStepHeader } from "./wizard-step-header.js";

export function ReviewStep() {
  const { control } = useFormContext<ExperimentWizardValues>();
  const values = useWatch({ control });
  const labels = useAgentLabels();

  return (
    <div>
      <WizardStepHeader
        step={3}
        title="Review & start"
        subtitle="Confirm the setup. Start now, or save as a draft and start later."
      />

      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        <ReviewRow label="Name">{values.name}</ReviewRow>
        <ReviewRow label="Prompt">
          <span className="whitespace-pre-wrap">{values.prompt}</span>
        </ReviewRow>
        <ReviewRow label="Arms">
          <div className="flex flex-col gap-2">
            {(values.arms ?? []).map((arm, index) => (
              <div
                key={`${arm?.agentId ?? index}`}
                className="flex items-center gap-2"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: armColor(arm?.agentId ?? "") }}
                />
                <span className="text-foreground">
                  {labels.get(arm?.agentId ?? "")?.name ?? arm?.agentId}
                </span>
                {arm?.variation?.trim() && (
                  <span className="truncate font-mono text-[12px] text-muted-foreground">
                    {arm.variation.replace(/\s+/g, " ").trim()}
                  </span>
                )}
              </div>
            ))}
          </div>
        </ReviewRow>
      </div>
    </div>
  );
}

function ReviewRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-4 p-4 text-[14px]">
      <span className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
