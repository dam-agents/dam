import { authFetch } from "../../../auth.js";
import { emitToast } from "../../../lib/toast.js";

/** Fetch the api-server's pre-rendered HTML usage report and open it in a
 *  new tab via a Blob URL. A plain `<a href>` can't send the Bearer header,
 *  so we fetch with auth, build a Blob, and `window.open` the resulting
 *  blob: URL. See html-report.ts for the wider design note (and the upgrade
 *  path to a React /usage route). */
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
    // Give the new tab a generous window to fetch the bytes before
    // dropping the URL. Once the tab has rendered the HTML, revoking
    // doesn't affect what it shows — it only frees the in-memory blob.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    emitToast({
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
