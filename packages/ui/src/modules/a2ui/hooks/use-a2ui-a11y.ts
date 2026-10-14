import type { Accessibility } from "../lib/schema.js";
import { useA2uiBindings } from "./use-a2ui-bindings.js";

export interface A11yAttributes {
  "aria-label"?: string;
  "aria-description"?: string;
  "aria-live"?: "off" | "polite" | "assertive";
  "aria-hidden"?: boolean;
}

export function useA2uiA11y(
  accessibility: Accessibility | undefined,
): A11yAttributes {
  const bindings = useA2uiBindings();
  if (!accessibility) return {};
  const { label, description, live, hidden } = accessibility;
  return {
    ...(label === undefined ? {} : { "aria-label": bindings.text(label) }),
    ...(description === undefined
      ? {}
      : { "aria-description": bindings.text(description) }),
    ...(live === undefined ? {} : { "aria-live": live }),
    ...(hidden === undefined ? {} : { "aria-hidden": bindings.flag(hidden) }),
  };
}
