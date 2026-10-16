import type { SliderComponent } from "api-server-api/chat-forms";
import { useId } from "react";

import { SectionLabel } from "@/components/ui/section-label";

import { useA2uiSurface } from "../../contexts/a2ui-surface-context.js";
import { useA2uiA11y } from "../../hooks/use-a2ui-a11y.js";
import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import { A2uiFieldMessages } from "./a2ui-field-messages.js";

interface Props {
  component: SliderComponent;
}

export function A2uiSlider({ component }: Props) {
  const { editable, setValue } = useA2uiSurface();
  const bindings = useA2uiBindings();
  const a11y = useA2uiA11y(component.accessibility);
  const inputId = useId();
  const { id, value, min = 0, max, steps, checks } = component;
  const current = bindings.number(value, id);
  const step = steps === undefined ? "any" : (max - min) / steps;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={inputId}>
          <SectionLabel>{bindings.text(component.label)}</SectionLabel>
        </label>
        <span className="text-sm tabular-nums text-muted-foreground">
          {current}
        </span>
      </div>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        disabled={!editable}
        onChange={(e) =>
          setValue(id, bindings.target(value, id), Number(e.target.value))
        }
        className="w-full accent-primary disabled:opacity-50"
        {...a11y}
      />
      <A2uiFieldMessages componentId={id} checks={checks} />
    </div>
  );
}
