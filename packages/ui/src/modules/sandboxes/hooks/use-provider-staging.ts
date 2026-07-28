import { type ConnectionView, providerTypeForTemplateId } from "api-server-api";
import { useMemo } from "react";

import type { ProviderRef } from "../../providers/components/provider-item.js";

interface Args {
  apps: readonly ConnectionView[];
  assignedAppIds: string[];
  /** Read at call time — a confirm dialog can hold `selectProvider` open
   *  across background grant refetches. */
  getAssignedAppIds: () => string[];
  setAssignedAppIds: (ids: string[]) => void;
}

/** Provider (model-credential) staging on top of the form's grant list. */
export function useProviderStaging({
  apps,
  assignedAppIds,
  getAssignedAppIds,
  setAssignedAppIds,
}: Args) {
  const providerAppIds = useMemo(
    () =>
      new Set(
        apps
          .filter((a) => providerTypeForTemplateId(a.templateId) !== null)
          .map((a) => a.id),
      ),
    [apps],
  );

  const selectedProvider = useMemo<ProviderRef | null>(() => {
    const connId = assignedAppIds.find((id) => providerAppIds.has(id));
    return connId ? { id: connId } : null;
  }, [assignedAppIds, providerAppIds]);

  // Selecting a provider swaps it in, clearing any other provider connection
  // so an agent never carries two providers at once.
  const selectProvider = (ref: ProviderRef) =>
    setAssignedAppIds(
      [
        ...new Set([
          ...getAssignedAppIds().filter((id) => !providerAppIds.has(id)),
          ref.id,
        ]),
      ].sort(),
    );

  return {
    providerAppIds,
    selectedProvider,
    selectProvider,
  };
}
