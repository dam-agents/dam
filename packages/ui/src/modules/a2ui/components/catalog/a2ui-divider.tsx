import type { DividerComponent } from "api-server-api/chat-forms";

import { cn } from "@/lib/utils";

interface Props {
  component: DividerComponent;
}

export function A2uiDivider({ component }: Props) {
  const vertical = component.axis === "vertical";
  return (
    <div
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={cn(
        "bg-border",
        vertical ? "w-px self-stretch" : "h-px w-full",
      )}
    />
  );
}
