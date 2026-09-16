import type { TelemetryExportSignal } from "api-server-api";

import { getErrorMessage } from "@/lib/errors";

import { authFetch } from "../../../auth.js";
import { emitToast } from "../../../lib/toast.js";

async function exportFailure(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (
      typeof body === "object" &&
      body !== null &&
      typeof (body as { error?: unknown }).error === "string"
    ) {
      return (body as { error: string }).error;
    }
  } catch {
    // TEST_SCENARIO: a non-JSON body is not worth a second failure
  }
  return `Export failed: ${res.status}`;
}

export async function downloadTelemetryExport(opts: {
  agentId: string;
  sessionId: string | null;
  signal: TelemetryExportSignal;
  sinceHours: number;
}): Promise<void> {
  const params = new URLSearchParams({
    agentId: opts.agentId,
    signal: opts.signal,
    sinceHours: String(opts.sinceHours),
  });
  if (opts.sessionId) params.set("sessionId", opts.sessionId);

  try {
    const res = await authFetch(`/api/telemetry/export?${params.toString()}`);
    if (!res.ok) {
      emitToast({ kind: "error", message: await exportFailure(res) });
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
