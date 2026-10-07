import type { UseFormRegister } from "react-hook-form";

import { FormField } from "@/components/form-field";
import { Select } from "@/components/ui/select";

import { useSessionModelChoices } from "../api/session-model.js";
import type { OnceFormValues } from "./once-form-schema.js";

export function OnceModelField({
  agentId,
  register,
}: {
  agentId: string;
  register: UseFormRegister<OnceFormValues>;
}) {
  const choices = useSessionModelChoices(agentId || null);
  if (choices.length === 0) return null;
  return (
    <FormField label="Model" disableInset>
      <Select className="h-10" {...register("model")}>
        <option value="">Agent default</option>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.name}
          </option>
        ))}
      </Select>
    </FormField>
  );
}
