import type { BudgetVmUsage } from "api-server-api";

import type { AgentView } from "../../../types.js";
import {
  formatSizeLabel,
  sizeInMi,
  type SlotUnit,
} from "../../budgets/lib/slots.js";

export interface AgentUsage {
  memoryBytes: number | null;
  storageBytes: number | null;
}

export function sandboxSubtitle(
  agent: AgentView,
  slotUnit: SlotUnit | null,
): string | null {
  if (agent.vm || !slotUnit || !agent.size.cpu || !agent.size.memory)
    return null;
  return formatSizeLabel(sizeInMi(agent.size), slotUnit);
}

// UNIT_BOUNDARY_DESCRIPTION: a vm agent's own measured share of its owner's pools. A figure the runner has not measured, and the memory of a paused agent, is null, so the row shows nothing rather than a zero.
export function agentUsage(
  agent: AgentView,
  vmUsage?: BudgetVmUsage | null,
): AgentUsage | null {
  if (!agent.vm) return null;
  const share = vmUsage?.agents.find((a) => a.id === agent.id);
  if (!share) return null;
  const memoryBytes =
    share.memoryUsedBytes > 0 && agent.state !== "hibernated"
      ? share.memoryUsedBytes
      : null;
  const storageBytes =
    share.storageUsedBytes > 0 ? share.storageUsedBytes : null;
  return memoryBytes === null && storageBytes === null
    ? null
    : { memoryBytes, storageBytes };
}
