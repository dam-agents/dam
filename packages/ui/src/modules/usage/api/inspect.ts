import { z } from "zod";

import { authFetch } from "../../../auth.js";

const inspectStatusSchema = z.object({ canInspect: z.boolean() });

export async function fetchUsageInspectAvailability(): Promise<boolean> {
  const res = await authFetch("/api/usage/inspect/status");
  const routeIsNotMounted = res.status === 404;
  const callerCannotUseThePlatform = res.status === 403;
  if (routeIsNotMounted || callerCannotUseThePlatform) return false;
  if (!res.ok) {
    throw new Error(
      `Couldn't check the usage analytics access (${res.status})`,
    );
  }
  return inspectStatusSchema.parse(await res.json()).canInspect;
}

export async function fetchUsageReportHtml(): Promise<string> {
  const res = await authFetch("/api/usage/report");
  if (!res.ok) {
    throw new Error(`Couldn't build the usage report (${res.status})`);
  }
  return res.text();
}
