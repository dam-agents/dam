import type { BudgetVmUsage } from "api-server-api";

import type { AgentView } from "../../../types.js";
import { formatBytes } from "../../budgets/lib/pools.js";
import {
  formatSizeLabel,
  sizeInMi,
  type SlotUnit,
} from "../../budgets/lib/slots.js";

export function sandboxSubtitle(
  agent: AgentView,
  slotUnit: SlotUnit | null,
  vmUsage?: BudgetVmUsage | null,
): string | null {
  if (agent.vm) {
    const share = vmUsage?.agents.find((a) => a.id === agent.id);
    if (!share) return null;
    const parts = [
      share.memoryUsedBytes > 0 &&
        agent.state !== "hibernated" &&
        `${formatBytes(share.memoryUsedBytes)} memory`,
      share.storageUsedBytes > 0 &&
        `${formatBytes(share.storageUsedBytes)} storage`,
    ].filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  if (!slotUnit || !agent.size.cpu || !agent.size.memory) return null;
  return formatSizeLabel(sizeInMi(agent.size), slotUnit);
}
