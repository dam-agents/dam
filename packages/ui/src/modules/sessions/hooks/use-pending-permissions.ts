import { useStore } from "../../../store.js";

/** Whether the currently viewed session has a pending tool-call approval. */
export function useHasPendingPermission(): boolean {
  return useStore((s) =>
    s.sessionId
      ? s.pendingPermissions.some((p) => p.sessionId === s.sessionId)
      : false,
  );
}
