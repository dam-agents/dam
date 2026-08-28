import { useStore } from "../../../store.js";

export function useOpenConversation(agentId: string | null): string | null {
  const selectedAgent = useStore((s) => s.selectedAgent);
  const sessionId = useStore((s) => s.sessionId);
  if (agentId === null || selectedAgent !== agentId) return null;
  return sessionId;
}
