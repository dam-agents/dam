import { useStore } from "../../../store.js";
import { useDeleteConnection } from "../../connections/api/mutations.js";
import type { ProviderRef } from "./provider-item.js";

export function useProviderActions() {
  const showConfirm = useStore((s) => s.showConfirm);
  const deleteConnection = useDeleteConnection();

  return {
    async remove(ref: ProviderRef) {
      const ok = await showConfirm(
        "Are you sure you want to remove this provider? Any agent currently using this provider will no longer work as expected.",
        "Remove Provider?",
        { kind: "destructive", confirmLabel: "Remove provider" },
      );
      if (!ok) return;
      deleteConnection.mutate({ id: ref.id });
    },
  };
}
