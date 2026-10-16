import {
  CheckmarkFilled,
  ErrorFilled,
  Information,
  WarningAltFilled,
} from "@carbon/icons-react";
import type { CalloutComponent, Tone } from "api-server-api/chat-forms";

import { cn } from "@/lib/utils";

import { useA2uiSurface } from "../../contexts/a2ui-surface-context.js";
import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import { A2uiMarkdown } from "./a2ui-markdown.js";

const ICON = {
  neutral: Information,
  info: Information,
  success: CheckmarkFilled,
  warning: WarningAltFilled,
  danger: ErrorFilled,
} as const;

const ACCENT_CLASS: Record<Tone, string> = {
  neutral: "border-l-border",
  info: "border-l-info",
  success: "border-l-success",
  warning: "border-l-warning",
  danger: "border-l-danger",
};

const ICON_CLASS: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  info: "text-info",
  success: "text-success",
  warning: "text-warning-fg",
  danger: "text-danger",
};

interface Props {
  component: CalloutComponent;
}

export function A2uiCallout({ component }: Props) {
  const { editable } = useA2uiSurface();
  const bindings = useA2uiBindings();
  const tone = bindings.tone(component.tone, "info");
  const Icon = ICON[tone];
  const title = bindings.text(component.title);
  return (
    <div
      data-slot="callout"
      className={cn(
        "flex gap-2.5 rounded-md border border-l-2 border-border bg-muted/30 px-3 py-2.5 transition-opacity",
        ACCENT_CLASS[tone],
        !editable && "opacity-50 grayscale",
      )}
    >
      <Icon size={16} className={cn("mt-0.5 shrink-0", ICON_CLASS[tone])} />
      <div className="flex min-w-0 flex-col gap-1">
        {title && <p className="font-medium text-foreground">{title}</p>}
        <A2uiMarkdown text={bindings.text(component.text)} />
      </div>
    </div>
  );
}
