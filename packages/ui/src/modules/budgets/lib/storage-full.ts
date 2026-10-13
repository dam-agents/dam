import { type BudgetStorageFull, storageFullSchema } from "api-server-api";

export function toStorageFull(error: unknown): BudgetStorageFull | null {
  const data = (error as { data?: unknown })?.data;
  if (!data || typeof data !== "object" || !("storageFull" in data))
    return null;
  const parsed = storageFullSchema.safeParse(data.storageFull);
  return parsed.success ? parsed.data : null;
}

// UNIT_BOUNDARY_DESCRIPTION: a refused vm agent — a create, a starter kit, a move onto the vm backend — explains itself in a dialog instead of a toast, because the way out is on another screen: the home dashboard, where the user deletes an agent or asks for more storage. True when the error was such a refusal and the dialog is on its way. The store is imported only then, so the query client that calls this does not build the store as it loads.
export function showStorageFull(error: unknown): boolean {
  if (!toStorageFull(error)) return false;
  const message = (error as Error).message;
  void import("../../../store.js").then(async ({ useStore }) => {
    const { showConfirm, setView } = useStore.getState();
    const ok = await showConfirm(message, "Your agents' storage is full", {
      confirmLabel: "Manage agents",
      cancelLabel: "Close",
    });
    if (ok) setView("home");
  });
  return true;
}
