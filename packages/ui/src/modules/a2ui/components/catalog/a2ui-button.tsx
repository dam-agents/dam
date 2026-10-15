import type { ButtonComponent } from "api-server-api/chat-forms";

import { Button, type ButtonProps } from "@/components/ui/button";

import { useA2uiScope } from "../../contexts/a2ui-scope-context.js";
import { useA2uiSurface } from "../../contexts/a2ui-surface-context.js";
import { useA2uiA11y } from "../../hooks/use-a2ui-a11y.js";
import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import { A2uiNode } from "../a2ui-node.js";

const VARIANT: Record<
  NonNullable<ButtonComponent["variant"]>,
  ButtonProps["variant"]
> = {
  primary: "default",
  default: "outline",
  borderless: "ghost",
};

interface Props {
  component: ButtonComponent;
  depth: number;
}

export function A2uiButton({ component, depth }: Props) {
  const { surface, editable, dispatch, runLocal } = useA2uiSurface();
  const bindings = useA2uiBindings();
  const scope = useA2uiScope();
  const a11y = useA2uiA11y(component.accessibility);
  const { action } = component;
  const failures = bindings.checks(component.checks);
  const local = "functionCall" in action;
  const child = surface.components.get(component.child);
  const label =
    child?.component === "Text" ? (
      bindings.text(child.text)
    ) : (
      <A2uiNode id={component.child} depth={depth + 1} />
    );

  function handleClick() {
    if ("functionCall" in action) {
      runLocal(action.functionCall, scope);
      return;
    }
    const { event } = action;
    dispatch({
      sourceComponentId: component.id,
      name: event.name,
      userMessage:
        event.userMessage === undefined
          ? undefined
          : bindings.text(event.userMessage),
      context: bindings.context(event.context, true),
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={VARIANT[component.variant ?? "default"]}
      disabled={(!local && !editable) || failures.length > 0}
      title={failures[0]?.message}
      onClick={handleClick}
      {...a11y}
    >
      {label}
    </Button>
  );
}
