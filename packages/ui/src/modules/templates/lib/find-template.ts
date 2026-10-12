import type { TemplateView } from "../../../types.js";

export function findTemplate(
  templates: readonly TemplateView[],
  id: string | null,
): TemplateView | undefined {
  if (id === null) return undefined;
  return (
    templates.find((t) => t.id === id) ??
    templates.find((t) => t.aliases?.includes(id))
  );
}
