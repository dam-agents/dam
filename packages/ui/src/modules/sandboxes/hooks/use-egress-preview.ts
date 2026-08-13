import type { AgentConnections, ConnectionView } from "api-server-api";
import { useMemo } from "react";

import type { StagedNetworkAccessController } from "../../egress-rules/components/agent-egress-editor.js";
import type { useStagedNetworkAccess } from "./use-staged-network-access.js";

type StagedNetworkAccess = ReturnType<typeof useStagedNetworkAccess>;

interface Args {
  net: StagedNetworkAccess;
  apps: readonly ConnectionView[];
  assignedAppIds: string[];
  savedConnections: AgentConnections["connections"] | undefined;
}

export function useEgressPreview({
  net,
  apps,
  assignedAppIds,
  savedConnections,
}: Args): StagedNetworkAccessController {
  const appIdsSet = useMemo(() => new Set(assignedAppIds), [assignedAppIds]);
  const baselineAppIds = useMemo(
    () => new Set(savedConnections?.map((c) => c.connectionId) ?? []),
    [savedConnections],
  );
  const pendingConnectionGrants = useMemo(() => {
    const out: { connectionId: string; host: string; label: string }[] = [];
    for (const id of assignedAppIds) {
      if (baselineAppIds.has(id)) continue;
      const a = apps.find((x) => x.id === id);
      if (!a) continue;
      for (const host of a.hosts)
        out.push({ connectionId: id, host, label: a.name });
    }
    return out;
  }, [assignedAppIds, baselineAppIds, apps]);
  const pendingConnectionRevokes = useMemo(() => {
    const next = new Set<string>();
    for (const id of baselineAppIds) if (!appIdsSet.has(id)) next.add(id);
    return next;
  }, [baselineAppIds, appIdsSet]);
  const connectionLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of apps) m.set(a.id, a.name);
    return m;
  }, [apps]);

  return {
    preset: net.stagedPreset,
    setPreset: net.setStagedPreset,
    pendingDeletes: net.pendingDeletes,
    togglePendingDelete: net.togglePendingDelete,
    pendingAdds: net.pendingAdds,
    appendPendingAdd: net.appendPendingAdd,
    removePendingAdd: net.removePendingAdd,
    pendingConnectionGrants,
    pendingConnectionRevokes,
    connectionLabels,
  };
}
