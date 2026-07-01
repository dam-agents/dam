import { useFieldArray, useFormContext } from "react-hook-form";

import { useAgentsList } from "../../../agents/api/queries.js";
import type { ExperimentWizardValues } from "../../forms/experiment-wizard-schema.js";
import { useAgentLabels } from "../../hooks/use-agent-labels.js";
import { AgentPicker } from "./agent-picker.js";
import { ArmFieldCard } from "./arm-field-card.js";
import { WizardStepHeader } from "./wizard-step-header.js";

export function ArmsStep() {
  const { control } = useFormContext<ExperimentWizardValues>();
  const { fields, append, remove } = useFieldArray({ control, name: "arms" });
  const agents = useAgentsList();
  const labels = useAgentLabels();

  const addedIds = new Set(fields.map((field) => field.agentId));
  const available = agents
    .filter((agent) => !addedIds.has(agent.id))
    .map((agent) => ({
      agentId: agent.id,
      name: agent.name,
      templateName: labels.get(agent.id)?.templateName ?? null,
    }));

  return (
    <div>
      <WizardStepHeader
        step={2}
        title="Add the arms"
        subtitle="Each arm is an existing agent plus an optional variation — free text appended to the shared prompt. Add two agents off the same image to race two variations."
      />

      <div className="flex flex-col gap-2">
        {fields.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-5 text-center text-[13px] text-muted-foreground">
            No arms yet. Add an agent below.
          </div>
        ) : (
          fields.map((field, index) => {
            const label = labels.get(field.agentId);
            return (
              <ArmFieldCard
                key={field.id}
                index={index}
                agentId={field.agentId}
                agentName={label?.name ?? field.agentId}
                templateName={label?.templateName ?? null}
                onRemove={() => remove(index)}
              />
            );
          })
        )}
      </div>

      <div className="mt-6">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Add an agent
        </p>
        <AgentPicker
          items={available}
          onAdd={(agentId) => append({ agentId, variation: "" })}
        />
      </div>
    </div>
  );
}
