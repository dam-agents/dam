import type { ConnectionTemplateInput } from "api-server-api";
import { type Control, Controller } from "react-hook-form";

import type { TemplateFormValues } from "../lib/template-form-schema.js";
import { hintFor, labelFor, placeholderFor } from "./field-copy.js";
import { LabeledInput } from "./labeled-input.js";

export function TemplateFieldInput({
  control,
  templateId,
  input,
}: {
  control: Control<TemplateFormValues>;
  templateId: string;
  input: ConnectionTemplateInput;
}) {
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
