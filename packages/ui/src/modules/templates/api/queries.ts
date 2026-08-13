import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import type { TemplateView } from "../../../types.js";

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
