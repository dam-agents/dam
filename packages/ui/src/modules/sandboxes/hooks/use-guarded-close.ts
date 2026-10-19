import { useStore } from "../../../store.js";

export function useGuardedClose(dirty: boolean, onClose: () => void) {
  const showConfirm = useStore((s) => s.showConfirm);
  return async () => {
    if (
      !dirty ||
      (await showConfirm("What you typed is lost.", "Discard changes?", {
        kind: "destructive",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
      }))
    )
      onClose();
  };
}
