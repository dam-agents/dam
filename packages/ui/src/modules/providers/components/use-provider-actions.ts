import { useStore } from "../../../store.js";
import { useDeleteConnection } from "../../connections/api/mutations.js";
import { useDeleteSecret } from "../../secrets/api/mutations.js";
import type { ProviderRef } from "./provider-item.js";

export function useProviderActions() {
  const showConfirm = useStore((s) => s.showConfirm);
  const deleteSecret = useDeleteSecret();
  const deleteConnection = useDeleteConnection();

  return {
    /** Confirm with the user, then delete the provider — routing by source so
     *  a legacy secret-backed provider still removes via the secrets path.
     *  Destructive variant: removing a provider breaks any agent using it. */
    async remove(ref: ProviderRef, onRemoved?: () => void) {
      const ok = await showConfirm(
        "Are you sure you want to remove this provider? Any agent currently using this provider will no longer work as expected.",
        "Remove Provider?",
        { kind: "destructive", confirmLabel: "Remove provider" },
      );
      if (!ok) return;
      const opts = onRemoved ? { onSuccess: () => onRemoved() } : undefined;
      if (ref.source === "connection") {
        deleteConnection.mutate({ id: ref.id }, opts);
      } else {
        deleteSecret.mutate({ id: ref.id }, opts);
      }
    },
  };
}
