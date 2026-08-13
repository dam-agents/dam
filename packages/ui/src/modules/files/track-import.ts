import { useStore } from "../../store.js";

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
