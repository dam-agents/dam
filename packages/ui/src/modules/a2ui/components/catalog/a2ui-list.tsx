import { cn } from "@/lib/utils";

import type { ListComponent } from "../../lib/schema.js";
import { A2uiChildren } from "./a2ui-children.js";
import { ALIGN_CLASS } from "./layout-classes.js";

interface Props {
  component: ListComponent;
  depth: number;
}

export function A2uiList({ component, depth }: Props) {
  const { direction = "vertical", align = "stretch", children } = component;
  return (
    <div
      className={cn(
        "flex min-w-0",
        direction === "horizontal"
          ? "flex-row gap-3 overflow-x-auto pb-1 [&>*]:max-w-[280px] [&>*]:shrink-0"
          : "flex-col divide-y divide-border [&>*]:py-2.5 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0",
        ALIGN_CLASS[align],
      )}
    >
      <A2uiChildren childList={children} depth={depth} />
    </div>
  );
}
