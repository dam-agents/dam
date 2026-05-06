import type { Context, MiddlewareHandler } from "hono";

/**
 * Peer-identity middleware for the harness port (ADR-039).
 *
 * The harness port sits behind an Istio ambient waypoint. The waypoint
 * terminates the inbound HBONE tunnel from ztunnel and forwards plaintext
 * HTTP to this process with an `x-forwarded-client-cert` (XFCC) header
 * carrying the peer's SPIFFE identity:
 *
 *     By=spiffe://<td>/ns/<svc-ns>/sa/<svc-sa>;Hash=...;Subject="";URI=spiffe://<td>/ns/<peer-ns>/sa/<peer-sa>;DNS=...
 *
 * The middleware extracts `URI=spiffe://<td>/ns/<peer-ns>/sa/<peer-sa>`,
 * verifies trust domain and namespace, and stashes the SA name on
 * `c.var.peerInstanceId` for downstream handlers. ADR-039's per-instance SA
 * scheme means the SA name *is* the instance ID — long-lived pods run as
 * the instance, fork pods reuse the parent instance's SA.
 *
 * Requests without a valid XFCC URI fail closed with 401. The waypoint is
 * the only path through which traffic reaches this listener — the
 * AuthorizationPolicy in the chart pre-filters anything else — so a missing
 * header in production indicates a misconfiguration, not a callable surface.
 */

export interface PeerIdentity {
  instanceId: string;
}

export interface PeerIdentityVars {
  peerInstanceId: string;
}

export interface PeerIdentityDeps {
  /** Trust domain Istio mints workload certs under. */
  trustDomain: string;
  /** Namespace agent + gateway pods run in. */
  agentNamespace: string;
}

const XFCC_HEADER = "x-forwarded-client-cert";

/**
 * Extract the inbound peer's SA name from an XFCC header value, given the
 * expected trust domain and namespace. Returns null on any parse / validation
 * failure — caller maps null to 401.
 *
 * Exported for unit tests.
 */
export function parsePeerSpiffe(
  xfcc: string | undefined | null,
  trustDomain: string,
  agentNamespace: string,
): string | null {
  if (!xfcc) return null;

  // XFCC may carry multiple comma-separated entries when there are multiple
  // proxy hops; the inbound peer is the *last* entry (closest to us). Each
  // entry is a list of `Key=Value` or `Key="Quoted Value"` separated by `;`.
  const lastEntry = splitTopLevel(xfcc, ",").pop();
  if (!lastEntry) return null;

  for (const kv of splitTopLevel(lastEntry, ";")) {
    const eq = kv.indexOf("=");
    if (eq === -1) continue;
    const key = kv.slice(0, eq).trim().toLowerCase();
    if (key !== "uri") continue;

    let value = kv.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    return validateSpiffe(value, trustDomain, agentNamespace);
  }
  return null;
}

function validateSpiffe(uri: string, trustDomain: string, agentNamespace: string): string | null {
  // SPIFFE URIs are URL-shaped with the scheme `spiffe`. We could lean on
  // `new URL()` but the path grammar Istio uses (`/ns/<ns>/sa/<sa>`) is
  // narrow enough that a regex is clearer and avoids URL's % decoding.
  const match = /^spiffe:\/\/([^/]+)\/ns\/([^/]+)\/sa\/([^/]+)$/.exec(uri);
  if (!match) return null;
  const [, td, ns, sa] = match;
  if (td !== trustDomain) return null;
  if (ns !== agentNamespace) return null;
  if (!sa) return null;
  return sa;
}

/**
 * Split `s` on `sep` ignoring `sep` characters that occur inside double
 * quotes. XFCC's `Subject="CN=foo, O=bar"` shape means a naive `.split(",")`
 * would shred a single entry into pieces.
 */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let start = 0;
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && ch === sep) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** Hono middleware that resolves the peer SA from XFCC and writes it to
 *  `c.var.peerInstanceId`. Fails closed with 401 on any miss. */
export function peerIdentityMiddleware(deps: PeerIdentityDeps): MiddlewareHandler {
  return async (c, next) => {
    const xfcc = c.req.header(XFCC_HEADER);
    const sa = parsePeerSpiffe(xfcc, deps.trustDomain, deps.agentNamespace);
    if (!sa) {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("peerInstanceId", sa);
    await next();
  };
}

/** Type-safe accessor for downstream handlers — pairs with
 *  `Hono<{ Variables: PeerIdentityVars }>`. */
export function getPeerInstanceId(c: Context): string {
  return c.get("peerInstanceId") as string;
}
