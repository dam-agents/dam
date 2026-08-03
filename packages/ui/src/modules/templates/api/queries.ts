import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import type { TemplateView } from "../../../types.js";

// Push experimental templates (e.g. nous) to the end of the catalogue so the
// stable, generally-available harnesses lead the list. Stable sort preserves
// the server's order within each group. Module-level so the `select` reference
// stays stable across renders.
function sortExperimentalLast(templates: TemplateView[]): TemplateView[] {
  return [...templates].sort(
    (a, b) => Number(a.experimental) - Number(b.experimental),
  );
}

export function useTemplates() {
  return useQuery({
    ...trpc.templates.list.queryOptions(),
    select: sortExperimentalLast,
    meta: { errorToast: "Couldn't load templates" },
  });
}
