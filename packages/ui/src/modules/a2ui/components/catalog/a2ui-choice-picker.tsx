import { useState } from "react";

import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";

import { useA2uiSurface } from "../../contexts/a2ui-surface-context.js";
import { useA2uiA11y } from "../../hooks/use-a2ui-a11y.js";
import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import type { ChoicePickerComponent } from "../../lib/schema.js";
import { A2uiChoiceOptions } from "./a2ui-choice-options.js";
import { A2uiFieldMessages } from "./a2ui-field-messages.js";

interface Props {
  component: ChoicePickerComponent;
}

export function A2uiChoicePicker({ component }: Props) {
  const { setValue } = useA2uiSurface();
  const bindings = useA2uiBindings();
  const a11y = useA2uiA11y(component.accessibility);
  const [filter, setFilter] = useState("");
  const { id, value, checks, filterable } = component;
  const path = bindings.target(value, id);
  const options = component.options
    .map((option) => ({
      value: option.value,
      label: bindings.text(option.label),
    }))
    .filter((option) =>
      option.label.toLowerCase().includes(filter.trim().toLowerCase()),
    );

  return (
    <fieldset className="flex flex-col gap-2" {...a11y}>
      {component.label !== undefined && (
        <legend className="mb-2">
          <SectionLabel>{bindings.text(component.label)}</SectionLabel>
        </legend>
      )}
      {filterable && (
        <Input
          size="sm"
          value={filter}
          placeholder="Filter options"
          aria-label="Filter options"
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      <A2uiChoiceOptions
        component={component}
        options={options}
        selected={bindings.stringList(value, id)}
        onChange={(next) => setValue(id, path, next)}
      />
      <A2uiFieldMessages componentId={id} checks={checks} />
    </fieldset>
  );
}
