import { useStore } from "../store.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The docked slot beside a conversation holds either
 * an artifact or a sandbox file, never both — opening one evicts the other and
 * throws away whatever draft it held. Both lineages ask this before they swap,
 * so a draft dies only when its owner has said so, whichever surface displaced
 * it. The store asks the same question when navigation leaves the chat.
 */
export function useDockDraftGuard() {
  return useStore((s) => s.confirmDockDiscard);
}
