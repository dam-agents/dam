import { cn } from "@/lib/utils";

import { useA2uiSurface } from "../../contexts/a2ui-surface-context.js";
import type { LayoutComponent } from "../../lib/schema.js";
import { A2uiChildren } from "./a2ui-children.js";
import { ALIGN_CLASS, JUSTIFY_CLASS } from "./layout-classes.js";

interface Props {
  component: LayoutComponent;
  depth: number;
}

export function A2uiLayout({ component, depth }: Props) {
  const { surface } = useA2uiSurface();
  const { justify = "start", align = "stretch", children } = component;
  const isRow = component.component === "Row";
  const textStack =
    Array.isArray(children) &&
    children.every((id) => surface.components.get(id)?.component === "Text");
  return (
    <div
      className={cn(
        "flex min-w-0",
        isRow
          ? "flex-row flex-wrap gap-2"
          : cn("flex-col", textStack ? "gap-1" : "gap-4"),
        JUSTIFY_CLASS[justify],
        ALIGN_CLASS[align],
      )}
    >
      <A2uiChildren childList={children} depth={depth} />
    </div>
  );
}
