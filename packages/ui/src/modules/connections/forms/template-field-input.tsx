import type { ConnectionTemplateInput } from "api-server-api";
import { type Control, Controller } from "react-hook-form";

import { FormField } from "@/components/form-field";
import { Select } from "@/components/ui/select";

import type { TemplateFormValues } from "../lib/template-form-schema.js";
import { hintFor, labelFor, placeholderFor } from "./field-copy.js";
import { LabeledInput } from "./labeled-input.js";

export function TemplateFieldInput({
  control,
  templateId,
  input,
  choices,
}: {
  control: Control<TemplateFormValues>;
  templateId: string;
  input: ConnectionTemplateInput;
  choices?: readonly string[];
}) {
  if (choices && choices.length > 0)
    return (
      <TemplateFieldChoice
        control={control}
        templateId={templateId}
        input={input}
        choices={choices}
      />
    );
  const optional = input.state === "optional";
  const basePlaceholder = placeholderFor(templateId, input.name);
  const placeholder = optional
    ? [basePlaceholder, "(optional)"].filter(Boolean).join(" ")
    : basePlaceholder;
  return (
    <Controller
      control={control}
      name={`fields.${input.name}`}
      render={({ field, fieldState }) => (
        <LabeledInput
          label={input.label ?? labelFor(input.name)}
          testId={`connection-field-${input.name}`}
          placeholder={placeholder}
          type={input.secret ? "password" : "text"}
          multiline={input.multiline}
          value={field.value ?? ""}
          onChange={field.onChange}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
          help={hintFor(templateId, input.name) ?? input.hint}
        />
      )}
    />
  );
}

function TemplateFieldChoice({
  control,
  templateId,
  input,
  choices,
}: {
  control: Control<TemplateFormValues>;
  templateId: string;
  input: ConnectionTemplateInput;
  choices: readonly string[];
}) {
  return (
    <Controller
      control={control}
      name={`fields.${input.name}`}
      render={({ field, fieldState }) => (
        <FormField
          label={input.label ?? labelFor(input.name)}
          hint={hintFor(templateId, input.name) ?? input.hint}
          error={fieldState.error?.message}
        >
          <Select
            data-testid={`connection-field-${input.name}`}
            value={field.value ?? ""}
            onChange={(e) => field.onChange(e.target.value)}
            onBlur={field.onBlur}
          >
            {choices.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </Select>
        </FormField>
      )}
    />
  );
}
