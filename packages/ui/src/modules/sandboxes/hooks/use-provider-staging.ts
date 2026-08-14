import { type ConnectionView, providerTypeForTemplateId } from "api-server-api";
import { useMemo } from "react";

import type { ProviderRef } from "../../providers/components/provider-item.js";

interface Args {
  apps: readonly ConnectionView[];
  assignedAppIds: string[];
  getAssignedAppIds: () => string[];
  setAssignedAppIds: (ids: string[]) => void;
}

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
