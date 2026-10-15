import type { TextFieldComponent } from "api-server-api/chat-forms";

import { FormField } from "@/components/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { useA2uiSurface } from "../../contexts/a2ui-surface-context.js";
import { useA2uiA11y } from "../../hooks/use-a2ui-a11y.js";
import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import { A2uiFieldMessages } from "./a2ui-field-messages.js";

const INPUT_TYPE = {
  shortText: "text",
  number: "number",
  obscured: "password",
} as const;

interface Props {
  component: TextFieldComponent;
}

export function A2uiTextField({ component }: Props) {
  const { editable, setValue } = useA2uiSurface();
  const bindings = useA2uiBindings();
  const a11y = useA2uiA11y(component.accessibility);
  const { id, value, variant = "shortText", checks } = component;
  const path = bindings.target(value, id);
  const field = {
    value: bindings.fieldText(value, id),
    placeholder: bindings.text(component.placeholder) || undefined,
    disabled: !editable,
    ...a11y,
  };

  return (
    <FormField label={bindings.text(component.label)}>
      {variant === "longText" ? (
        <Textarea
          {...field}
          onChange={(e) => setValue(id, path, e.target.value)}
        />
      ) : (
        <Input
          type={INPUT_TYPE[variant]}
          {...field}
          onChange={(e) => setValue(id, path, e.target.value)}
        />
      )}
      <A2uiFieldMessages componentId={id} checks={checks} />
    </FormField>
  );
}
