import { useMemo } from "react";

import { useA2uiScope } from "../contexts/a2ui-scope-context.js";
import { useA2uiSurface } from "../contexts/a2ui-surface-context.js";
import { type A2uiBindings, createBindings } from "../lib/bindings.js";

export function useA2uiBindings(): A2uiBindings {
  const { dataModel, surface } = useA2uiSurface();
  const scope = useA2uiScope();
  return useMemo(
    () =>
      createBindings({
        model: dataModel,
        scope: scope.path,
        indexes: scope.indexes,
        catalogId: surface.catalogId,
        userActivation: false,
      }),
    [dataModel, scope, surface.catalogId],
  );
}
