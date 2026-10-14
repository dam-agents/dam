import type { ApprovalView } from "api-server-api";

import { useStore } from "../../../store.js";
import { useDismissApprovals } from "../api/mutations.js";
import {
  deniableApprovalIds,
  denyAllPrompt,
  denyBatches,
} from "../lib/deny-all.js";

export function useDenyApprovals() {
  const dismissMany = useDismissApprovals();
  const showConfirm = useStore((s) => s.showConfirm);

  const denyAll = async (
    approvals: readonly ApprovalView[],
  ): Promise<boolean> => {
    const ids = deniableApprovalIds(approvals);
    if (ids.length === 0) return false;
    const prompt = denyAllPrompt(ids.length);
    const ok = await showConfirm(prompt.message, prompt.title, {
      kind: "destructive",
      confirmLabel: prompt.confirmLabel,
    });
    if (!ok) return false;
    try {
      for (const batch of denyBatches(ids)) {
        await dismissMany.mutateAsync({ ids: batch });
      }
      return true;
    } catch {
      return false;
    }
  };

  return { denyAll, denying: dismissMany.isPending };
}
