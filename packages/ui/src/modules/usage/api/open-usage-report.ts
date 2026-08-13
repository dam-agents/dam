import { getErrorMessage } from "@/lib/errors";

import { authFetch } from "../../../auth.js";
import { emitToast } from "../../../lib/toast.js";

export async function openUsageReport(): Promise<void> {
  try {
    const res = await authFetch("/api/usage/report");
    if (!res.ok) {
      emitToast({
        kind: "error",
        message: `Usage report failed: ${res.status}`,
      });
      return;
    }
    const html = await res.text();
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    emitToast({
      kind: "error",
      message: getErrorMessage(err),
    });
  }
}
