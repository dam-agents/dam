import {
  CheckmarkFilled,
  ErrorFilled,
  Information,
  WarningAltFilled,
} from "@carbon/icons-react";

import { Callout, type CalloutProps } from "@/components/ui/callout";
import { cn } from "@/lib/utils";

import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import type { CalloutComponent, Tone } from "../../lib/schema.js";
import { A2uiMarkdown } from "./a2ui-markdown.js";

const TONE: Record<Tone, CalloutProps["tone"]> = {
  neutral: "muted",
  info: "info",
  success: "default",
  warning: "warning",
  danger: "danger",
};

const TONE_CLASS: Partial<Record<Tone, string>> = {
  success: "border-success/40 bg-success-light",
};

const ICON = {
  neutral: Information,
  info: Information,
  success: CheckmarkFilled,
  warning: WarningAltFilled,
  danger: ErrorFilled,
} as const;

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
  const bindings = useA2uiBindings();
  const tone = bindings.tone(component.tone, "info");
  const Icon = ICON[tone];
  const title = bindings.text(component.title);
  return (
    <Callout
      tone={TONE[tone]}
      size="sm"
      className={cn("flex gap-2.5", TONE_CLASS[tone])}
    >
      <Icon size={16} className={cn("mt-0.5 shrink-0", ICON_CLASS[tone])} />
      <div className="flex min-w-0 flex-col gap-1">
        {title && <p className="font-semibold text-foreground">{title}</p>}
        <A2uiMarkdown text={bindings.text(component.text)} />
      </div>
    </Callout>
  );
}
