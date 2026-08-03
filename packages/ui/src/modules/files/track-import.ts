import { useStore } from "../../store.js";

/** Run `fn` while the agent reads as importing; balances begin/end on throw, no-ops when agentId is null. */
export async function trackImport<T>(
  agentId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  if (!agentId) return fn();
  const { beginImport, endImport } = useStore.getState();
  beginImport(agentId);
  try {
    return await fn();
  } finally {
    endImport(agentId);
  }
}
