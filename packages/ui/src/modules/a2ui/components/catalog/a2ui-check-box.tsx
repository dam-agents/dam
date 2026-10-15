import type { CheckBoxComponent } from "api-server-api/chat-forms";

import { CheckboxItem } from "@/components/ui/checkbox";

import { useA2uiSurface } from "../../contexts/a2ui-surface-context.js";
import { useA2uiA11y } from "../../hooks/use-a2ui-a11y.js";
import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import { splitRecommended } from "../../lib/recommended.js";
import { A2uiFieldMessages } from "./a2ui-field-messages.js";
import { A2uiRecommendedMark } from "./a2ui-recommended-mark.js";

interface Props {
  component: CheckBoxComponent;
}

export function A2uiCheckBox({ component }: Props) {
  const { editable, setValue } = useA2uiSurface();
  const bindings = useA2uiBindings();
  const a11y = useA2uiA11y(component.accessibility);
  const { id, value, checks } = component;
  const label = bindings.text(component.label);
  const { text, recommended } = splitRecommended(label);
  return (
    <div className="flex flex-col gap-1">
      <CheckboxItem
        label={text}
        labelSuffix={recommended && <A2uiRecommendedMark />}
        aria-label={label}
        checked={bindings.boolean(value, id)}
        disabled={!editable}
        onCheckedChange={(checked) =>
          setValue(id, bindings.target(value, id), checked === true)
        }
        {...a11y}
      />
      <A2uiFieldMessages componentId={id} checks={checks} />
    </div>
  );
}
