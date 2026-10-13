import type { AgentView } from "../../../types.js";
import {
  formatSizeLabel,
  sizeInMi,
  type SlotUnit,
} from "../../budgets/lib/slots.js";

export function sandboxSubtitle(
  agent: AgentView,
  slotUnit: SlotUnit | null,
): string | null {
  if (agent.vm || !slotUnit || !agent.size.cpu || !agent.size.memory)
    return null;
  return formatSizeLabel(sizeInMi(agent.size), slotUnit);
}
