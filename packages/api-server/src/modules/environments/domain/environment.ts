import type { EnvironmentEndpoint } from "api-server-api";

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface EnvironmentRecord {
  agentId: string;
  owningAgentId: string;
  owner: string;
  name: string;
  host: string;
  endpoints: EnvironmentEndpoint[];
  access: string[] | null;
  expiresAt: Date;
  createdAt: Date;
}

export const HOST_LABEL_MAX = 63;
const ENDPOINT_NAME_MAX = 12;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The label an Environment's endpoint addresses share,
 * `<endpoint>-<host>` under the environments domain. It is the Environment's
 * name and a random suffix, so two Agents may both name one `pr-42`, and short
 * enough that the longest endpoint name still fits the 63 characters a DNS
 * label allows. Endpoint names carry no hyphen, so the first hyphen of an
 * address splits the endpoint from the host.
 */
export function environmentHost(name: string, suffix: string): string {
  const room = HOST_LABEL_MAX - ENDPOINT_NAME_MAX - 1 - suffix.length - 1;
  const base = name.slice(0, room).replace(/-+$/, "");
  return `${base}-${suffix}`;
}

export function endpointAddress(endpoint: string, host: string): string {
  return `${endpoint}-${host}`;
}

export function endpointUrl(
  urlTemplate: string | null,
  endpoint: string,
  host: string,
): string | null {
  if (urlTemplate === null) return null;
  return urlTemplate.replace("{host}", () => endpointAddress(endpoint, host));
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Resolves the expiry an owning Agent or its owner
 * asks for. It is a date in the future and at most the install's maximum ahead
 * of now; a request past the maximum is cut to it rather than refused, so
 * "extend by a month" does what it can.
 */
export function clampExpiry(
  requested: Date,
  now: Date,
  maxDays: number,
): Date | { error: string } {
  if (Number.isNaN(requested.getTime()))
    return { error: "the expiry is not a date" };
  if (requested.getTime() <= now.getTime())
    return { error: "the expiry must be in the future" };
  const max = now.getTime() + maxDays * DAY_MS;
  return new Date(Math.min(requested.getTime(), max));
}

export function environmentAgentName(owningAgentName: string, name: string) {
  return `${owningAgentName} · ${name}`;
}
