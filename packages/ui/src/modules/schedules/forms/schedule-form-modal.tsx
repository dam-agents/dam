import { useState } from "react";

import { FormField } from "@/components/form-field";
import { Modal } from "@/components/modal";
import { Select } from "@/components/ui/select";

import type { Schedule } from "../../../types.js";
import { OnceScheduleForm } from "./once-schedule-form.js";
import { RecurringScheduleForm } from "./recurring-schedule-form.js";
import { type ScheduleKind, ScheduleKindField } from "./schedule-kind-field.js";

interface Props {
  agentId?: string;
  agentChoices?: readonly { id: string; name: string }[];
  existing?: Schedule;
  onClose: () => void;
  onSaved: () => void;
}

export function ScheduleFormModal({
  agentId,
  agentChoices,
  existing,
  onClose,
  onSaved,
}: Props) {
  const [chosenAgent, setChosenAgent] = useState(agentId ?? "");
  const [kind, setKind] = useState<ScheduleKind>(
    existing?.type === "once" ? "once" : "repeat",
  );
  const targetAgentId = existing?.agentId ?? agentId ?? chosenAgent;

  const leadingFields = existing ? undefined : (
    <>
      <ScheduleKindField value={kind} onChange={setKind} />
      {agentChoices && (
        <FormField label="Agent" disableInset>
          <Select
            className="h-10"
            value={chosenAgent}
            onChange={(event) => setChosenAgent(event.target.value)}
          >
            <option value="" disabled>
              Choose an agent
            </option>
            {agentChoices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.name}
              </option>
            ))}
          </Select>
        </FormField>
      )}
    </>
  );

  const formProps = {
    targetAgentId,
    ...(existing ? { existing } : {}),
    leadingFields,
    onClose,
    onSaved,
  };

  return (
    <Modal>
      {kind === "once" ? (
        <OnceScheduleForm {...formProps} />
      ) : (
        <RecurringScheduleForm {...formProps} />
      )}
    </Modal>
  );
}
