import type { EgressPreset } from "api-server-api";
import { useEffect, useState } from "react";

import type { PendingAdd } from "../../egress-rules/components/agent-egress-editor.js";

export function useStagedNetworkAccess(agentId: string | null) {
  const [stagedPreset, setStagedPreset] = useState<EgressPreset | null>(null);
  const [pendingDeletes, setPendingDeletes] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pendingAdds, setPendingAdds] = useState<readonly PendingAdd[]>([]);

  const reset = () => {
    setStagedPreset(null);
    setPendingDeletes(new Set());
    setPendingAdds([]);
  };

  useEffect(() => {
    setStagedPreset(null);
    setPendingDeletes(new Set());
    setPendingAdds([]);
  }, [agentId]);

  const togglePendingDelete = (id: string) =>
    setPendingDeletes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const appendPendingAdd = (draft: Omit<PendingAdd, "tempId">) =>
    setPendingAdds((prev) => [
      ...prev,
      { ...draft, tempId: crypto.randomUUID() },
    ]);
  const removePendingAdd = (tempId: string) =>
    setPendingAdds((prev) => prev.filter((a) => a.tempId !== tempId));

  const dirty =
    stagedPreset !== null || pendingDeletes.size > 0 || pendingAdds.length > 0;

  return {
    stagedPreset,
    setStagedPreset,
    pendingDeletes,
    togglePendingDelete,
    pendingAdds,
    appendPendingAdd,
    removePendingAdd,
    reset,
    dirty,
  };
}
