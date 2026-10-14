import type { CSSProperties } from "react";

import { TextSkeleton } from "@/components/ui/text-skeleton";
import { cn } from "@/lib/utils";

import { useA2uiSurface } from "../contexts/a2ui-surface-context.js";
import { useA2uiA11y } from "../hooks/use-a2ui-a11y.js";
import { resolvesInCatalog } from "../lib/conversation.js";
import type { A2uiComponent as Component } from "../lib/schema.js";
import { A2uiComponent } from "./a2ui-component.js";
import { A2uiNodeBoundary } from "./a2ui-node-boundary.js";

const MAX_DEPTH = 24;

const LABELS_OWN_CONTROL: ReadonlySet<Component["component"]> = new Set([
  "Button",
  "TextField",
  "CheckBox",
  "ChoicePicker",
  "Slider",
  "DateTimeInput",
]);

function A2uiWrapped({
  component,
  depth,
}: {
  component: Component;
  depth: number;
}) {
  const a11y = useA2uiA11y(
    LABELS_OWN_CONTROL.has(component.component)
      ? undefined
      : component.accessibility,
  );
  const { weight } = component;
  const content = <A2uiComponent component={component} depth={depth} />;
  if (weight === undefined && Object.keys(a11y).length === 0) return content;
  return (
    <div
      role={a11y["aria-label"] ? "group" : undefined}
      {...a11y}
      style={
        weight === undefined
          ? undefined
          : ({ "--a2ui-weight": weight } as CSSProperties)
      }
      className={cn(
        "min-w-0",
        weight !== undefined && "basis-0 grow-(--a2ui-weight)",
      )}
    >
      {content}
    </div>
  );
}

interface Props {
  id: string;
  depth: number;
}

export function A2uiNode({ id, depth }: Props) {
  const { surface } = useA2uiSurface();
  const component = surface.components.get(id);
  if (depth > MAX_DEPTH) return null;
  if (!component)
    return surface.streaming ? <TextSkeleton width="60%" /> : null;
  if (!resolvesInCatalog(component, surface)) return null;
  return (
    <A2uiNodeBoundary
      componentId={id}
      component={component}
      streaming={surface.streaming}
    >
      <A2uiWrapped component={component} depth={depth} />
    </A2uiNodeBoundary>
  );
}
