import type { EnvironmentEndpoint } from "api-server-api";

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface EnvironmentRecord {
  agentId: string;
  owningAgentId: string;
  owner: string;
  name: string;
  host: string;
  endpoints: EnvironmentEndpoint[];
  // UNIT_BOUNDARY_DESCRIPTION: when the expiry sweep deletes it; null when it is kept with no expiry.
  expiresAt: Date | null;
  createdAt: Date;
}

// UNIT_BOUNDARY_DESCRIPTION: an expiry as the owner or the Owning Agent asks for it: a date, or "never" to keep the Environment until someone deletes it.
export type ExpiryRequest = Date | "never";

// UNIT_BOUNDARY_DESCRIPTION: an idle timeout as the Owning Agent asks for it: whole minutes, or "never" to keep the Environment awake.
export type IdleTimeoutRequest = number | "never";

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
 * "extend by a month" does what it can. "never" keeps the Environment with no
 * expiry, which the maximum does not bound: the owner's own runner pays for it.
 */
export function clampExpiry(
  requested: ExpiryRequest,
  now: Date,
  maxDays: number,
): Date | null | { error: string } {
  if (requested === "never") return null;
  if (Number.isNaN(requested.getTime()))
    return { error: "the expiry is not a date" };
  if (requested.getTime() <= now.getTime())
    return { error: "the expiry must be in the future" };
  const max = now.getTime() + maxDays * DAY_MS;
  return new Date(Math.min(requested.getTime(), max));
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Resolves the idle timeout an owning Agent asks
 * for, in minutes: the install's default for Environments when it asks for
 * none, and at most the install's maximum, cut down to it as an expiry is.
 * "never" resolves to zero, which the controller reads as never sleeping, and
 * the maximum does not bound it; a number below one minute is refused, so only
 * the word turns sleep off.
 */
export function clampIdleTimeout(
  requested: IdleTimeoutRequest | undefined,
  defaultMin: number,
  maxMin: number,
): number | { error: string } {
  if (requested === "never") return NEVER_SLEEPS_MIN;
  const minutes = requested ?? defaultMin;
  if (!Number.isInteger(minutes) || minutes < 1)
    return {
      error:
        'the idle timeout must be at least one minute, or "never" to keep the Environment awake',
    };
  return Math.min(minutes, maxMin);
}

// UNIT_BOUNDARY_DESCRIPTION: the idle timeout, in minutes, of an Environment that never sleeps: the Agent's `hibernationTimeout: 0s`, which the controller's idle sweep and memory reclaim both skip.
export const NEVER_SLEEPS_MIN = 0;

export function environmentAgentName(owningAgentName: string, name: string) {
  return `${owningAgentName} · ${name}`;
}
