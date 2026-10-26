import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import type { TemplateView } from "../../../types.js";
import { withHarnessTemplates } from "../lib/harness-templates.js";

function sortExperimentalLast(templates: TemplateView[]): TemplateView[] {
  return [...templates].sort(
    (a, b) => Number(a.experimental) - Number(b.experimental),
  );
}

export function useTemplates() {
  const templates = useQuery({
    ...trpc.templates.list.queryOptions(),
    select: sortExperimentalLast,
    meta: { errorToast: "Couldn't load templates" },
  });
  const catalogue = useQuery({
    ...trpc.templates.harnesses.queryOptions(),
    meta: { errorToast: "Couldn't load templates" },
  });
  const data =
    templates.data === undefined
      ? undefined
      : withHarnessTemplates(templates.data, catalogue.data);
  return { ...templates, data };
}
