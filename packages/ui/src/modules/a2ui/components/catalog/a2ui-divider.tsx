import { cn } from "@/lib/utils";

import type { DividerComponent } from "../../lib/schema.js";

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
