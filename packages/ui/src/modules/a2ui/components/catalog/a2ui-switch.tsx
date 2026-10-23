import type { SwitchComponent } from "api-server-api/chat-forms";

import { ToggleRow } from "@/components/ui/toggle-row";

import { useA2uiSurface } from "../../contexts/a2ui-surface-context.js";
import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import { splitRecommended } from "../../lib/recommended.js";
import { A2uiFieldMessages } from "./a2ui-field-messages.js";
import { A2uiRecommendedMark } from "./a2ui-recommended-mark.js";

interface Props {
  component: SwitchComponent;
}

export function A2uiSwitch({ component }: Props) {
  const { editable, setValue } = useA2uiSurface();
  const bindings = useA2uiBindings();
  const { id, value, checks } = component;
  const label = bindings.text(component.label);
  const description = bindings.text(component.description);
  const { text, recommended } = splitRecommended(label);
  return (
    <div className="flex flex-col gap-1">
      <ToggleRow
        title={
          <>
            {text}
            {recommended && <A2uiRecommendedMark />}
          </>
        }
        label={label}
        description={description}
        checked={bindings.boolean(value, id)}
        disabled={!editable}
        onCheckedChange={(checked) =>
          setValue(id, bindings.target(value, id), checked)
        }
      />
      <A2uiFieldMessages componentId={id} checks={checks} />
    </div>
  );
}
