import type { CopyState } from "@/hooks/use-copy";
import { emitToast } from "@/lib/toast";

const COPIED_TTL_MS = 2500;

export function toastCopyOutcome(state: CopyState): void {
  emitToast(
    state === "copied"
      ? { kind: "success", message: "Link copied.", ttl: COPIED_TTL_MS }
      : { kind: "error", message: "Couldn't copy the link." },
  );
}
