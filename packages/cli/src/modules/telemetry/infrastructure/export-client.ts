import type { TelemetryExportSignal } from "api-server-api";

export interface ExportRequest {
  agentId: string;
  sessionId?: string;
  signal: TelemetryExportSignal;
  sinceHours: number;
}

export type ExportOutcome =
  | { kind: "ok"; body: string; truncated: boolean }
  | { kind: "failed"; status: number; reason: string };

export function exportPath(req: ExportRequest): string {
  const params = new URLSearchParams({
    agentId: req.agentId,
    signal: req.signal,
    sinceHours: String(req.sinceHours),
  });
  if (req.sessionId !== undefined) params.set("sessionId", req.sessionId);
  return `/api/telemetry/export?${params.toString()}`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the export is the one timeline read that does not
 * go over tRPC — it is a streamed file with a row cap far above what a typed
 * query returns, so it is fetched from the route directly with the same bearer
 * token the tRPC client uses.
 */
export function createExportClient(deps: {
  host: string;
  getToken: () => Promise<string | null>;
  fetch?: typeof globalThis.fetch;
}) {
  const doFetch = deps.fetch ?? globalThis.fetch;
  return {
    async run(req: ExportRequest): Promise<ExportOutcome> {
      const token = await deps.getToken();
      if (token === null) {
        return { kind: "failed", status: 401, reason: "not logged in" };
      }
      const res = await doFetch(
        new URL(exportPath(req), deps.host).toString(),
        {
          headers: { authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) {
        return {
          kind: "failed",
          status: res.status,
          reason: await failureReason(res),
        };
      }
      return {
        kind: "ok",
        body: await res.text(),
        truncated: res.headers.get("x-platform-truncated") === "true",
      };
    },
  };
}

async function failureReason(res: Response): Promise<string> {
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
    return res.statusText;
  }
  return res.statusText;
}
