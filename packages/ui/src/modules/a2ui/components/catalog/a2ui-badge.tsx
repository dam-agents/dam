import { Badge, type BadgeProps } from "@/components/ui/badge";

import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import type { BadgeComponent, Tone } from "../../lib/schema.js";

const VARIANT: Record<Tone, BadgeProps["variant"]> = {
  neutral: "muted",
  info: "info",
  success: "success",
  warning: "warning",
  danger: "danger",
};

interface Props {
  component: BadgeComponent;
}

export function A2uiBadge({ component }: Props) {
  const bindings = useA2uiBindings();
  const text = bindings.text(component.text);
  const tone = bindings.tone(component.tone, "neutral");
  return (
    <Badge variant={VARIANT[tone]} className="self-start">
      {text}
    </Badge>
  );
}
