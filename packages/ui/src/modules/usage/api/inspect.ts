import { z } from "zod";

import { authFetch } from "../../../auth.js";

const inspectStatusSchema = z.object({ canInspect: z.boolean() });

export async function fetchUsageInspectAvailability(): Promise<boolean> {
  const res = await authFetch("/api/usage/inspect/status");
  const routeIsNotMounted = res.status === 404;
  if (routeIsNotMounted) return false;
  if (!res.ok) {
    throw new Error(
      `Could not check the usage analytics access (${res.status})`,
    );
  }
  return inspectStatusSchema.parse(await res.json()).canInspect;
}

export async function fetchUsageReportPage(): Promise<string> {
  const res = await authFetch("/api/usage/report");
  if (!res.ok) {
    throw new Error(`Could not build the usage report (${res.status})`);
  }
  const html = await res.text();
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return url;
}
