import type { DateTimeInputComponent } from "api-server-api/chat-forms";

import { FormField } from "@/components/form-field";
import { Input } from "@/components/ui/input";

import { useA2uiSurface } from "../../contexts/a2ui-surface-context.js";
import { useA2uiA11y } from "../../hooks/use-a2ui-a11y.js";
import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import { toInputValue } from "../../lib/date-time.js";
import { A2uiFieldMessages } from "./a2ui-field-messages.js";

function inputType({ enableDate, enableTime }: DateTimeInputComponent) {
  if (enableDate && enableTime) return "datetime-local";
  return enableTime ? "time" : "date";
}

interface Props {
  component: DateTimeInputComponent;
}

export function A2uiDateTimeInput({ component }: Props) {
  const { editable, setValue } = useA2uiSurface();
  const bindings = useA2uiBindings();
  const a11y = useA2uiA11y(component.accessibility);
  const { id, value, min, max, checks } = component;
  const type = inputType(component);
  const limit = (bound: typeof min) =>
    bound === undefined ? undefined : toInputValue(type, bindings.text(bound));
  return (
    <FormField label={bindings.text(component.label)}>
      <Input
        type={type}
        value={toInputValue(type, bindings.fieldText(value, id))}
        min={limit(min)}
        max={limit(max)}
        disabled={!editable}
        onChange={(e) =>
          setValue(id, bindings.target(value, id), e.target.value)
        }
        {...a11y}
      />
      <A2uiFieldMessages componentId={id} checks={checks} />
    </FormField>
  );
}
