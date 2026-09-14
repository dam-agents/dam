import type { TimelineExportSignal } from "api-server-api";

import { getErrorMessage } from "@/lib/errors";

import { authFetch } from "../../../auth.js";
import { emitToast } from "../../../lib/toast.js";

export async function downloadTimelineExport(opts: {
  agentId: string;
  sessionId: string | null;
  signal: TimelineExportSignal;
  sinceHours: number;
}): Promise<void> {
  const params = new URLSearchParams({
    agentId: opts.agentId,
    signal: opts.signal,
    sinceHours: String(opts.sinceHours),
  });
  if (opts.sessionId) params.set("sessionId", opts.sessionId);

  try {
    const res = await authFetch(`/api/timeline/export?${params.toString()}`);
    if (!res.ok) {
      const detail =
        res.status === 412
          ? "Telemetry is not enabled on this deployment."
          : `Export failed: ${res.status}`;
      emitToast({ kind: "error", message: detail });
      return;
    }
    const truncated = res.headers.get("x-platform-truncated") === "true";
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      res.headers
        .get("content-disposition")
        ?.match(/filename="([^"]+)"/)?.[1] ?? "timeline.ndjson";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (truncated) {
      emitToast({
        kind: "info",
        message: "Export hit the row cap — narrow the window for the rest.",
      });
    }
  } catch (err) {
    emitToast({ kind: "error", message: getErrorMessage(err) });
  }
}
