import { useStore } from "../../../store.js";
import { sessionTitleLabel } from "../lib/session-title.js";

export function useConfirmDeleteSession() {
  const showConfirm = useStore((s) => s.showConfirm);
  return (session: { title?: string | null; sessionId: string }) =>
    showConfirm(
      "Its transcript is deleted and cannot be recovered.",
      `Delete session ${session.title ? `“${session.title}”` : sessionTitleLabel(session)}?`,
      { kind: "destructive", confirmLabel: "Delete session" },
    );
}
