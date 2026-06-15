import { useStore } from "../../../store.js";
import { useDeleteConnection } from "../api/mutations.js";

/**
 * Confirm-then-delete a connection. Deleting is global — it removes the
 * connection for every sandbox — so this always confirms first. Shared by
 * every surface that lists connections (the create wizard, the sandbox
 * settings page, and Settings → Connections) so the destructive action reads
 * identically everywhere. `confirmAndDelete` resolves to whether the user
 * confirmed, so callers can run follow-up work (e.g. drop a staged grant).
 */
export function useDisconnectConnection() {
  const del = useDeleteConnection();
  const showConfirm = useStore((s) => s.showConfirm);

  const confirmAndDelete = async (
    id: string,
    name: string,
  ): Promise<boolean> => {
    const ok = await showConfirm(
      `Disconnect "${name}"? This removes the connection for all sandboxes and can't be undone.`,
      "Disconnect connection",
      { kind: "destructive", confirmLabel: "Disconnect" },
    );
    if (ok) del.mutate({ id });
    return ok;
  };

  return {
    confirmAndDelete,
    deletingId: del.isPending ? (del.variables?.id ?? null) : null,
  };
}
