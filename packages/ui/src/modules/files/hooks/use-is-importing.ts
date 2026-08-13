import { useStore } from "../../../store.js";

export function useIsImporting(agentId: string | null): boolean {
  return useStore((s) =>
    agentId ? (s.importingAgents[agentId] ?? 0) > 0 : false,
  );
}
