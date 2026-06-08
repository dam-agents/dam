import { useStore } from "../../../store.js";

/** True while one or more uploads/imports are in flight for this agent. */
export function useIsImporting(agentId: string | null): boolean {
  return useStore((s) =>
    agentId ? (s.importingAgents[agentId] ?? 0) > 0 : false,
  );
}
