import type { SwitchComponent } from "api-server-api/chat-forms";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

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
      <label
        className={cn(
          "flex items-start justify-between gap-4",
          editable && "cursor-pointer",
        )}
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">
            {text}
            {recommended && <A2uiRecommendedMark />}
          </span>
          {description && (
            <span className="mt-0.5 block text-sm text-muted-foreground">
              {description}
            </span>
          )}
        </span>
        <Switch
          label={label}
          checked={bindings.boolean(value, id)}
          disabled={!editable}
          onCheckedChange={(checked) =>
            setValue(id, bindings.target(value, id), checked)
          }
        />
      </label>
      <A2uiFieldMessages componentId={id} checks={checks} />
    </div>
  );
}
