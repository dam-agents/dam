import type { BadgeComponent, Tone } from "api-server-api/chat-forms";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { useA2uiSurface } from "../../contexts/a2ui-surface-context.js";
import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";

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
  const { editable } = useA2uiSurface();
  const bindings = useA2uiBindings();
  const text = bindings.text(component.text);
  const tone = bindings.tone(component.tone, "neutral");
  return (
    <Badge
      variant={VARIANT[tone]}
      className={cn("self-start", !editable && "opacity-50 grayscale")}
    >
      {text}
    </Badge>
  );
}
