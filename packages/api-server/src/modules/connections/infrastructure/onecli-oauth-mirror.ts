/**
 * Mirrors API-Server-driven OAuth tokens into OneCLI as **generic secrets**
 * — kept in step with the K8s connection Secret so non-flagged instances
 * (those still on the OneCLI gateway) can use the same credential.
 *
 * OneCLI's app-connection API isn't usable here: the app registry hardcodes
 * the providers it knows about and drives the OAuth dance internally, with
 * no input path for tokens minted elsewhere. Generic secrets carry a host
 * pattern + injection rule and are the right shape for "OneCLI just inject
 * Authorization on this host on the wire."
 *
 * Naming convention: `__humr_oauth:<connection>` disambiguates from MCP's
 * existing `__humr_mcp:<host>` secrets while keeping the prefix scheme
 * recognizable in OneCLI's secret list.
 */
import type { EnvMapping } from "api-server-api";

import type { OnecliClient } from "../../../apps/api-server/onecli.js";

const OAUTH_SECRET_PREFIX = "__humr_oauth:";

interface OnecliSecretRow {
  id: string;
  name: string;
  type: string;
  hostPattern: string;
  injectionConfig: { headerName: string; valueFormat?: string; expiresAt?: number } | null;
  createdAt: string;
}

export function oauthSecretName(connection: string): string {
  return `${OAUTH_SECRET_PREFIX}${connection}`;
}

export async function listOAuthSecretsViaOnecli(
  oc: OnecliClient,
  userJwt: string,
  userSub: string,
): Promise<OnecliSecretRow[]> {
  const res = await oc.onecliFetch(userJwt, userSub, "/api/secrets");
  if (!res.ok) throw new Error(`OneCLI list secrets failed: ${res.status}`);
  const all = (await res.json()) as OnecliSecretRow[];
  return all.filter((s) => s.name.startsWith(OAUTH_SECRET_PREFIX));
}

/**
 * Upsert a Humr-managed OAuth token in OneCLI as a generic secret. Writes
 * `Authorization: Bearer <token>` injection by default; the host pattern is
 * what the OneCLI gateway matches on outbound. Existing same-named secret
 * is deleted first — OneCLI doesn't expose a true upsert.
 */
export async function upsertOAuthSecretViaOnecli(
  oc: OnecliClient,
  userJwt: string,
  userSub: string,
  input: {
    connection: string;
    hostPattern: string;
    accessToken: string;
    expiresAt?: number;
    /** Override the default `Authorization: Bearer {value}`. */
    injection?: { headerName: string; valueFormat?: string };
    /**
     * Pod env vars to inject into agents granted access to this secret. The
     * controller picks these up from `metadata.envMappings` and writes them
     * into each instance's StatefulSet — that's how `gh` CLI sees `GH_TOKEN`
     * after the user grants the GitHub connection.
     */
    envMappings?: EnvMapping[];
  },
): Promise<void> {
  const name = oauthSecretName(input.connection);
  const existing = await listOAuthSecretsViaOnecli(oc, userJwt, userSub);
  const old = existing.find((s) => s.name === name);
  if (old) {
    const del = await oc.onecliFetch(userJwt, userSub, `/api/secrets/${old.id}`, {
      method: "DELETE",
    });
    if (!del.ok) {
      const body = await del.text();
      throw new Error(`OneCLI delete (pre-upsert) failed: ${del.status} ${body}`);
    }
  }
  const headerName = input.injection?.headerName ?? "authorization";
  const valueFormat = input.injection?.valueFormat ?? "Bearer {value}";
  const res = await oc.onecliFetch(userJwt, userSub, "/api/secrets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      type: "generic",
      value: input.accessToken,
      hostPattern: input.hostPattern,
      injectionConfig: {
        headerName,
        valueFormat,
        ...(input.expiresAt != null ? { expiresAt: input.expiresAt } : {}),
      },
      ...(input.envMappings && input.envMappings.length > 0
        ? { metadata: { envMappings: input.envMappings } }
        : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OneCLI create OAuth secret failed: ${res.status} ${body}`);
  }
}

export async function deleteOAuthSecretViaOnecli(
  oc: OnecliClient,
  userJwt: string,
  userSub: string,
  connection: string,
): Promise<void> {
  const name = oauthSecretName(connection);
  const existing = await listOAuthSecretsViaOnecli(oc, userJwt, userSub);
  const row = existing.find((s) => s.name === name);
  if (!row) return;
  const res = await oc.onecliFetch(userJwt, userSub, `/api/secrets/${row.id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`OneCLI delete OAuth secret failed: ${res.status}`);
}
