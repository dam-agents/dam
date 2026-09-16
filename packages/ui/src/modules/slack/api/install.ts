import { z } from "zod";

import { getAccessToken } from "../../../auth.js";

const installStatusSchema = z.object({ canInstall: z.boolean() });
const installLinkSchema = z.object({ url: z.url() });

async function authFetch(path: string): Promise<Response> {
  const token = await getAccessToken();
  return fetch(path, { headers: { Authorization: `Bearer ${token}` } });
}

export async function fetchSlackInstallAvailability(): Promise<boolean> {
  const res = await authFetch("/api/slack/install/status");
  const routeIsNotMounted = res.status === 404;
  if (routeIsNotMounted || !res.ok) return false;
  return installStatusSchema.parse(await res.json()).canInstall;
}

export async function fetchSlackInstallLink(): Promise<string> {
  const res = await authFetch("/api/slack/install/start");
  if (!res.ok) {
    throw new Error(`Could not start the install (${res.status})`);
  }
  return installLinkSchema.parse(await res.json()).url;
}
