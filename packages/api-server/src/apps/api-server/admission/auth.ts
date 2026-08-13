import type { IncomingMessage } from "node:http";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { JOSEError, JWKSInvalid, JWKSTimeout } from "jose/errors";
import type { Context } from "hono";
import { ALL_SCOPES, type Scope, type UserIdentity } from "api-server-api";
import type { Result } from "../../../core/result.js";
import { securityLog } from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";
import {
  isApiKeyToken,
  type ApiKeyValidationFailure,
  type ValidatedApiKey,
} from "../../../modules/api-keys/index.js";

export class ForbiddenError extends Error {
  constructor(
    public readonly requiredRole: string,
    /** Decoded subject of the rejected token — carried so the 403 can be
     *  audited against a known principal. */
    public readonly sub: string,
  ) {
    super(`Missing required role: ${requiredRole}`);
  }
}

/** Best-effort client IP behind Traefik/Istio (first `X-Forwarded-For` hop). */
export function clientIp(c: Context): string | undefined {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return c.req.header("x-real-ip") ?? undefined;
}

/** First-mile client IP of an upgrade request (the `clientIp` twin for
 *  handlers that see the raw request instead of a Hono context). */
export function upgradeSourceIp(req: IncomingMessage): string | undefined {
  const fwd = req.headers["x-forwarded-for"];
  return (
    (typeof fwd === "string" ? fwd.split(",")[0]!.trim() : undefined) ??
    req.socket.remoteAddress ??
    undefined
  );
}

export class UnauthorizedError extends Error {
  constructor(public readonly reason: string) {
    super(`Unauthorized: ${reason}`);
    this.name = "UnauthorizedError";
  }
}

/** Token verification could not run: the JWKS could not be retrieved
 *  (Keycloak unreachable, fetch timeout, non-200/non-JSON response). Not an
 *  authentication verdict — the token was never evaluated. Mapped to 503 so
 *  clients retry instead of treating an infra failure as a credential
 *  rejection; still a deny (fails closed). */
export class AuthUnavailableError extends Error {
  readonly reason = "jwks-unavailable";
  constructor(cause: unknown) {
    super("Authentication unavailable: JWKS could not be retrieved", {
      cause,
    });
    this.name = "AuthUnavailableError";
  }
}

/** Strict allowlist of failures where the JWKS could not be retrieved or
 *  ingested (jose 6.x): its fetch maps abort timeouts to JWKSTimeout, throws
 *  bare JOSEError (ERR_JOSE_GENERIC — used nowhere else in the library) on a
 *  non-200/non-JSON response, throws JWKSInvalid on a fetched-but-malformed
 *  body (a broken gateway answering 200 with a JSON error), and rethrows
 *  undici's network `TypeError: fetch failed` unwrapped.
 *
 *  The TypeError arm is gated on a `.cause`: undici's fetch failure always
 *  carries one (ECONNREFUSED, ENOTFOUND, …), whereas jose's own internal
 *  TypeErrors are message-only. This matters for security — jose can throw a
 *  bare `TypeError('non-ASCII string encountered in encode()')` while building
 *  the signing input from an attacker-supplied payload segment, *before* the
 *  signature is checked; without the `.cause` gate a forged token would be
 *  misclassified 503/`authn.unavailable` instead of 401/`authn.deny`, letting
 *  an attacker move forged-token probes out of the deny audit stream. Gating
 *  on `.cause` (not on the message string, which drifts across Node/undici)
 *  keeps every real fetch failure a 503 while every token failure — and jose's
 *  message-only key-material TypeErrors — stays a 401. JWKSNoMatchingKey
 *  (rotated/foreign kid) is likewise a 401. */
function isJwksRetrievalFailure(err: unknown): boolean {
  return (
    err instanceof JWKSTimeout ||
    err instanceof JWKSInvalid ||
    (err instanceof TypeError && err.cause != null) ||
    (err instanceof JOSEError && err.code === "ERR_JOSE_GENERIC")
  );
}

/** Value-free summary for the audit line: error name plus the undici cause
 *  code (ECONNREFUSED, ENOTFOUND, …) when present. */
function describeJwksFailure(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err.cause as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? `${err.name}: ${code}` : err.name;
}

export interface AuthConfig {
  /** External issuer URL (matches token `iss` claim), e.g. http://keycloak.localhost:4444/realms/platform */
  issuerUrl: string;
  /** Internal JWKS endpoint for key fetching, e.g. http://platform-keycloak:8080/realms/platform/protocol/openid-connect/certs */
  jwksUrl: string;
  /** Expected audience in access tokens (e.g. "platform-api") */
  audience?: string;
  /** Realm role required to access the API (e.g. "platform-access"). If unset, all authenticated users are allowed. */
  requiredRole?: string;
  /** OIDC client ID used by the web UI; matched against JWT `azp` to attribute requests to surface="ui". */
  uiClientId: string;
  /** OIDC client ID used by the dam CLI; matched against JWT `azp` to attribute requests to surface="cli". */
  cliClientId: string;
  /** Realm role marking a user as core team (used by activity tracking to
   *  exclude internal traffic from pilot metrics). Empty/unset = nobody is
   *  flagged core. Read from JWT `realm_access.roles` at verify time. */
  coreRole?: string;
}

export interface AuthDeps {
  /** Validates a `pk_…` (platform key) token. Optional — when omitted,
   *  API-key tokens are rejected so deployments without the api-keys module
   *  wired in remain JWT-only. */
  verifyApiKey?: (
    token: string,
  ) => Promise<Result<ValidatedApiKey, ApiKeyValidationFailure>>;
  /** Per-request owner-still-active check for API-key principals. Returns
   *  false if the owner no longer exists in Keycloak; the key is then
   *  treated as revoked for the request. JWT principals don't need this
   *  (Keycloak signs each access token). */
  verifyOwnerActive?: (sub: string) => Promise<boolean>;
}

/** Resolved principal plus the JWT-only telemetry signals (`azp`, realm
 *  `roles`). API-key principals carry empty values for both — they are not
 *  JWTs, so they have no `azp` and no realm roles. */
export interface VerifiedPrincipal {
  user: UserIdentity;
  azp: string;
  roles: string[];
  /** When the verified credential stops being valid. Consumers that hold a
   *  connection open past a single request (WS relays, the events socket)
   *  must not let it outlive this instant. Absent for API keys — their
   *  expiry and revocation are enforced per verify call, so connection
   *  owners apply their own re-auth deadline instead. */
  expiresAt?: Date;
}

export function createAuth(config: AuthConfig, deps: AuthDeps = {}) {
  const JWKS = createRemoteJWKSet(new URL(config.jwksUrl));

  async function verifyJwt(token: string): Promise<VerifiedPrincipal> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, JWKS, {
        issuer: config.issuerUrl,
        audience: config.audience,
        algorithms: ["RS256"],
      }));
    } catch (err) {
      if (isJwksRetrievalFailure(err)) throw new AuthUnavailableError(err);
      throw err;
    }

    const claims = payload as Record<string, unknown>;
    const realmAccess = claims.realm_access as { roles?: string[] } | undefined;
    const roles = realmAccess?.roles ?? [];

    if (config.requiredRole && !roles.includes(config.requiredRole)) {
      throw new ForbiddenError(config.requiredRole, payload.sub!);
    }

    return {
      user: {
        sub: payload.sub!,
        preferredUsername:
          (claims.preferred_username as string) ?? payload.sub!,
        // Browser-flow principals carry full effective scopes; agent binding
        // is unconstrained (wildcard). The API-key path narrows both.
        scopes: ALL_SCOPES,
        agentIds: "*",
      },
      azp: typeof claims.azp === "string" ? claims.azp : "",
      roles,
      expiresAt:
        payload.exp !== undefined ? new Date(payload.exp * 1000) : undefined,
    };
  }

  async function verifyApiKey(token: string): Promise<VerifiedPrincipal> {
    if (!deps.verifyApiKey) {
      throw new UnauthorizedError("api keys not enabled");
    }
    const result = await deps.verifyApiKey(token);
    if (!result.ok) throw new UnauthorizedError(result.error);

    const key = result.value;
    // Per-request owner-active check. When the owner has been deleted in
    // Keycloak, any of their keys lose authority immediately — no revocation
    // sweep is needed. Role demotion within Keycloak is a weaker form of this
    // check and is deferred to a follow-up.
    if (deps.verifyOwnerActive) {
      const active = await deps.verifyOwnerActive(key.ownerSub);
      if (!active) throw new UnauthorizedError("owner inactive");
    }

    // API-key principals are not JWTs: no `azp` (surface attribution falls
    // back to "other") and no realm roles (never flagged core team).
    return {
      user: {
        sub: key.ownerSub,
        preferredUsername: key.ownerSub,
        scopes: key.scopes,
        agentIds: key.agentIds,
        keyId: key.id,
      },
      azp: "",
      roles: [],
    };
  }

  async function verify(token: string): Promise<VerifiedPrincipal> {
    return isApiKeyToken(token) ? verifyApiKey(token) : verifyJwt(token);
  }

  // `reload()` fetches the JWKS immediately and populates jose's cache —
  // the boot-time warm hook behind `/api/ready` (see jwks-warmup.ts).
  return { verify, warmJwks: () => JWKS.reload() };
}

// ---------------------------------------------------------------------------
// Principal-authorization helpers (non-tRPC surfaces)
// ---------------------------------------------------------------------------

/** Binding check for non-tRPC surfaces (in-pod relay, WS upgrade,
 *  import proxy). Returns true when the principal may operate `agentId`. */
export function hasAgentBinding(user: UserIdentity, agentId: string): boolean {
  return user.agentIds === "*" || user.agentIds.includes(agentId);
}

/** Scope guard for non-tRPC surfaces. tRPC routers use the
 *  procedure builders in api-server-api/auth-procedures.ts. */
export function hasScope(user: UserIdentity, scope: Scope): boolean {
  return user.scopes.includes(scope);
}

// ---------------------------------------------------------------------------
// The shared authentication leg
// ---------------------------------------------------------------------------
// Every edge admits a principal the same way; what differs is where the
// token rides (HTTP header, query string, first WS frame) and how a denial
// is delivered. Classification and the audit vocabulary live here, once;
// each edge encodes the returned kind through its folder's mappers.

/** Where an authentication attempt happened. Drives which audit vocabulary
 *  the log line uses — event names and field shapes are a contract for
 *  audit-trail consumers, so each edge keeps its established lines. */
export type AuthSite =
  | { edge: "http"; target: string; sourceIp?: string }
  | {
      edge: "ws";
      /** Which WS surface: "acp" | "terminal" | "ssh" | "trpc". */
      relay: string;
      agentId?: string;
      sourceIp?: string;
    };

/** The WS flavor of AuthSite — socket surfaces build it once per connection
 *  and reuse it for every gate and the attach log. */
export type WsAuthSite = Extract<AuthSite, { edge: "ws" }>;

/** Why authentication refused a principal — semantic only, and only the
 *  kinds this file can produce (other gates own theirs, e.g. terms'
 *  "terms-stale"). Wire encoding belongs to the edge that delivers the
 *  denial, through its folder's mappers. */
export type AuthDenialKind =
  | "missing-token"
  | "auth-unavailable"
  | "unauthorized"
  | "forbidden";

export type AuthenticateResult =
  | { ok: true; principal: VerifiedPrincipal }
  | { ok: false; kind: AuthDenialKind };

/** The one authentication decision, bound to a verifier — defined once in
 *  app.ts and threaded into every edge (HTTP middleware, relay admission,
 *  tRPC WS endpoint), so no edge can construct its own. */
export type Authenticate = (
  token: string | null | undefined,
  site: AuthSite,
) => Promise<AuthenticateResult>;

/** OIDC client ids matched against JWT `azp` to attribute an authentication
 *  to surface="ui" / "cli"; `coreRole` flags core-team users. */
export interface SurfaceAttribution {
  uiClientId: string;
  cliClientId: string;
  coreRole?: string;
}

/** The usage-analytics fact "a credential was verified for this principal" —
 *  emitted once per HTTP request (auth middleware) and once per WS
 *  connection (tRPC WS admission). Feeds the auth Activity Event and
 *  `actor_roles.is_core`; one helper so the emission sites cannot drift. */
export function emitUserAuthenticated(
  principal: VerifiedPrincipal,
  attribution: SurfaceAttribution,
): void {
  const surface =
    principal.azp === attribution.uiClientId
      ? "ui"
      : principal.azp === attribution.cliClientId
        ? "cli"
        : "other";
  const isCore = attribution.coreRole
    ? principal.roles.includes(attribution.coreRole)
    : false;
  emit({
    type: EventType.UserAuthenticated,
    userSub: principal.user.sub,
    surface,
    isCore,
  });
}

function wsLogBase(site: WsAuthSite) {
  return {
    surface: "ws" as const,
    ...(site.agentId !== undefined ? { agentId: site.agentId } : {}),
    sourceIp: site.sourceIp,
    detail: { relay: site.relay },
  };
}

/** The authentication leg every edge shares — token presence and `verify` —
 *  with classification and the deny audit vocabulary in one place so edges
 *  cannot drift. Strictly "who are you": callers compose their own gates
 *  after it (terms, owner, scope) and deliver every denial through their
 *  own mapper. */
export async function authenticatePrincipal(
  verify: (token: string) => Promise<VerifiedPrincipal>,
  token: string | null | undefined,
  site: AuthSite,
): Promise<AuthenticateResult> {
  if (!token) {
    if (site.edge === "http") {
      securityLog("warn", "authn.deny", {
        category: "authn",
        actor: null,
        actorKind: "external",
        result: "failure",
        reason: "missing-bearer",
        target: site.target,
        sourceIp: site.sourceIp,
      });
    } else {
      securityLog("warn", "ws.authn_deny", {
        category: "authn",
        actor: null,
        actorKind: "external",
        decision: "deny",
        reason: "missing-token",
        ...wsLogBase(site),
      });
    }
    return { ok: false, kind: "missing-token" };
  }

  let principal: VerifiedPrincipal;
  try {
    principal = await verify(token);
  } catch (err) {
    if (err instanceof AuthUnavailableError) {
      // No credential verdict was reached (hence no `decision` field): the
      // JWKS fetch failed, so signal a retryable outage, not a rejection.
      if (site.edge === "http") {
        securityLog("warn", "authn.unavailable", {
          category: "authn",
          actor: null,
          actorKind: "external",
          result: "failure",
          reason: err.reason,
          target: site.target,
          sourceIp: site.sourceIp,
          detail: { cause: describeJwksFailure(err.cause) },
        });
      } else {
        securityLog("warn", "ws.authn_unavailable", {
          category: "authn",
          actor: null,
          actorKind: "external",
          result: "failure",
          reason: err.reason,
          ...wsLogBase(site),
        });
      }
      return { ok: false, kind: "auth-unavailable" };
    }
    if (err instanceof ForbiddenError) {
      // Known principal denied for lack of a required role — the most
      // forensically interesting authz event.
      if (site.edge === "http") {
        securityLog("warn", "authz.deny", {
          category: "authz",
          actor: err.sub,
          actorKind: "user",
          result: "failure",
          reason: "missing-required-role",
          target: site.target,
          sourceIp: site.sourceIp,
          detail: { requiredRole: err.requiredRole },
        });
      } else {
        securityLog("warn", "ws.authz_deny", {
          category: "authz",
          actor: err.sub,
          actorKind: "user",
          decision: "deny",
          reason: "missing-required-role",
          ...wsLogBase(site),
        });
      }
      return { ok: false, kind: "forbidden" };
    }
    // Token present but invalid — log the failure class (never the token
    // itself): expired/bad-signature/wrong-audience are replay and tampering
    // signals; API-key denials carry their reason string ("revoked", "owner
    // inactive", …) so key misuse is distinguishable from JWT failures in
    // the audit trail.
    const reason =
      err instanceof UnauthorizedError
        ? err.reason
        : err instanceof Error
          ? err.name
          : "verify-failed";
    if (site.edge === "http") {
      securityLog("warn", "authn.deny", {
        category: "authn",
        actor: null,
        actorKind: "external",
        result: "failure",
        reason,
        target: site.target,
        sourceIp: site.sourceIp,
      });
    } else {
      securityLog("warn", "ws.authn_deny", {
        category: "authn",
        actor: null,
        actorKind: "external",
        decision: "deny",
        reason,
        ...wsLogBase(site),
      });
    }
    return { ok: false, kind: "unauthorized" };
  }

  return { ok: true, principal };
}

/** The high-value forensic event every WS surface emits once fully
 *  admitted: someone is attached and live. */
export function logWsAttach(sub: string, site: WsAuthSite): void {
  securityLog("info", "relay.attach", {
    category: "privileged",
    actor: sub,
    actorKind: "user",
    surface: "ws",
    ...(site.agentId !== undefined ? { agentId: site.agentId } : {}),
    result: "success",
    sourceIp: site.sourceIp,
    detail: { relay: site.relay },
  });
}
