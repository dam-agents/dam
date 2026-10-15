import { useStore } from "../../../store.js";

export function useHasPendingPermission(): boolean {
  return useStore((s) =>
    s.sessionId
      ? s.pendingPermissions.some((p) => p.sessionId === s.sessionId)
      : false,
  );
}

export function useHasPendingQuestion(): boolean {
  return useStore((s) =>
    s.sessionId
      ? s.pendingElicitations.some((e) => e.sessionId === s.sessionId)
      : false,
  );
}
