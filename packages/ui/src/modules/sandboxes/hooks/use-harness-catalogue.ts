import { useEffect, useMemo } from "react";

import type { TemplateView } from "../../../types.js";
import { useTemplates } from "../../templates/api/queries.js";
import {
  imageCatalogue,
  reconcileHarnessSelection,
} from "../lib/image-catalogue.js";

interface HarnessCatalogue {
  harnesses: TemplateView[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useHarnessCatalogue(selection: {
  templateId: string | null;
  allowNone: boolean;
  onTemplateIdChange: (templateId: string | null) => void;
}): HarnessCatalogue {
  const { data: templates, isLoading, isError, refetch } = useTemplates();
  const { templateId, allowNone, onTemplateIdChange } = selection;

  const harnesses = useMemo(
    () => imageCatalogue(templates ?? []).harnesses,
    [templates],
  );

  const catalogueSettled = templates !== undefined;
  useEffect(() => {
    if (!catalogueSettled) return;
    const fix = reconcileHarnessSelection(harnesses, templateId, { allowNone });
    if (fix) onTemplateIdChange(fix.templateId);
  }, [catalogueSettled, harnesses, templateId, allowNone, onTemplateIdChange]);

  return { harnesses, isLoading, isError, refetch: () => void refetch() };
}
