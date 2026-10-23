import type { IncomingMessage } from "node:http";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { match } from "ts-pattern";
import { JOSEError, JWKSInvalid, JWKSTimeout } from "jose/errors";
import type { Context } from "hono";
import { ALL_SCOPES, type Scope, type UserIdentity } from "api-server-api";
import type { Result } from "../../../core/result.js";
import {
  securityLog,
  type ActorKind,
  type SecurityCategory,
} from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";
import {
  isApiKeyToken,
  type ApiKeyValidationFailure,
  type ValidatedApiKey,
} from "../../../modules/api-keys/index.js";

class ForbiddenError extends Error {
  constructor(
    public readonly requiredRole: string,
    public readonly sub: string,
  ) {
    super(`Missing required role: ${requiredRole}`);
  }
}

export function clientIp(c: Context): string | undefined {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return c.req.header("x-real-ip") ?? undefined;
}

export function upgradeSourceIp(req: IncomingMessage): string | undefined {
  const fwd = req.headers["x-forwarded-for"];
  return (
    (typeof fwd === "string" ? fwd.split(",")[0]!.trim() : undefined) ??
    req.socket.remoteAddress ??
    undefined
  );
}

class UnauthorizedError extends Error {
  constructor(public readonly reason: string) {
    super(`Unauthorized: ${reason}`);
    this.name = "UnauthorizedError";
  }
}

class AuthUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Authentication unavailable: JWKS could not be retrieved", {
      cause,
    });
    this.name = "AuthUnavailableError";
  }
}

function isJwksRetrievalFailure(err: unknown): boolean {
  return (
    err instanceof JWKSTimeout ||
    err instanceof JWKSInvalid ||
    (err instanceof TypeError && err.cause != null) ||
    (err instanceof JOSEError && err.code === "ERR_JOSE_GENERIC")
  );
}

function describeJwksFailure(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err.cause as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? `${err.name}: ${code}` : err.name;
}

export interface AuthConfig {
  issuers: string[];
  jwksUrl: string;
  audience?: string;
  requiredRole?: string;
  operatorRole?: string;
}

export interface AuthDeps {
  verifyApiKey?: (
    token: string,
  ) => Promise<Result<ValidatedApiKey, ApiKeyValidationFailure>>;
  verifyOwnerActive?: (sub: string) => Promise<boolean>;
}

export interface VerifiedPrincipal {
  user: UserIdentity;
  azp: string;
  roles: string[];
  expiresAt?: Date;
}

export function createAuth(config: AuthConfig, deps: AuthDeps = {}) {
  const JWKS = createRemoteJWKSet(new URL(config.jwksUrl));

  async function verifyJwt(token: string): Promise<VerifiedPrincipal> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, JWKS, {
        issuer: config.issuers,
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
        scopes: ALL_SCOPES,
        agentIds: "*",
        isOperator:
          !!config.operatorRole && roles.includes(config.operatorRole),
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
    if (deps.verifyOwnerActive) {
      const active = await deps.verifyOwnerActive(key.ownerSub);
      if (!active) throw new UnauthorizedError("owner inactive");
    }

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

  return { verify, warmJwks: () => JWKS.reload() };
}

export function hasAgentBinding(user: UserIdentity, agentId: string): boolean {
  return user.agentIds === "*" || user.agentIds.includes(agentId);
}

export function hasScope(user: UserIdentity, scope: Scope): boolean {
  return user.scopes.includes(scope);
}

export type AuthSite =
  | { edge: "http"; target: string; sourceIp?: string }
  | {
      edge: "ws";
      relay: string;
      agentId?: string;
      sourceIp?: string;
    };

export type WsAuthSite = Extract<AuthSite, { edge: "ws" }>;

export type AuthDenialKind =
  "missing-token" | "auth-unavailable" | "unauthorized" | "forbidden";

export type AuthenticateResult =
  | { ok: true; principal: VerifiedPrincipal }
  | { ok: false; kind: AuthDenialKind };

export type Authenticate = (
  token: string | null | undefined,
  site: AuthSite,
) => Promise<AuthenticateResult>;

export interface SurfaceAttribution {
  uiClientId: string;
  cliClientId: string;
  coreRole?: string;
}

export function clientSurface(
  principal: VerifiedPrincipal,
  attribution: SurfaceAttribution,
): string {
  return principal.azp === attribution.uiClientId
    ? "ui"
    : principal.azp === attribution.cliClientId
      ? "cli"
      : "other";
}

export function emitUserAuthenticated(
  principal: VerifiedPrincipal,
  attribution: SurfaceAttribution,
): void {
  const surface = clientSurface(principal, attribution);
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

const DENIAL_LOG: Record<
  AuthDenialKind,
  {
    httpEvent: string;
    wsEvent: string;
    category: SecurityCategory;
    actorKind: ActorKind;
    reason: string | { http: string; ws: string };
    wsFields: { decision: "deny" } | { result: "failure" };
  }
> = {
  "missing-token": {
    httpEvent: "authn.deny",
    wsEvent: "ws.authn_deny",
    category: "authn",
    actorKind: "external",
    reason: { http: "missing-bearer", ws: "missing-token" },
    wsFields: { decision: "deny" },
  },
  "auth-unavailable": {
    httpEvent: "authn.unavailable",
    wsEvent: "ws.authn_unavailable",
    category: "authn",
    actorKind: "external",
    reason: "jwks-unavailable",
    wsFields: { result: "failure" },
  },
  unauthorized: {
    httpEvent: "authn.deny",
    wsEvent: "ws.authn_deny",
    category: "authn",
    actorKind: "external",
    reason: "verify-failed",
    wsFields: { decision: "deny" },
  },
  forbidden: {
    httpEvent: "authz.deny",
    wsEvent: "ws.authz_deny",
    category: "authz",
    actorKind: "user",
    reason: "missing-required-role",
    wsFields: { decision: "deny" },
  },
};

function logDenial(
  site: AuthSite,
  kind: AuthDenialKind,
  fields: {
    actor: string | null;
    reason?: string;
    detail?: Record<string, unknown>;
  },
): void {
  const config = DENIAL_LOG[kind];
  const reason =
    fields.reason ??
    (typeof config.reason === "string"
      ? config.reason
      : config.reason[site.edge]);
  const { event, edgeFields } = match(site)
    .with({ edge: "http" }, (s) => ({
      event: config.httpEvent,
      edgeFields: {
        result: "failure" as const,
        reason,
        target: s.target,
        sourceIp: s.sourceIp,
        ...(fields.detail === undefined ? {} : { detail: fields.detail }),
      },
    }))
    .with({ edge: "ws" }, (s) => ({
      event: config.wsEvent,
      edgeFields: { ...config.wsFields, reason, ...wsLogBase(s) },
    }))
    .exhaustive();
  securityLog("warn", event, {
    category: config.category,
    actor: fields.actor,
    actorKind: config.actorKind,
    ...edgeFields,
  });
}

export async function authenticatePrincipal(
  verify: (token: string) => Promise<VerifiedPrincipal>,
  token: string | null | undefined,
  site: AuthSite,
): Promise<AuthenticateResult> {
  if (!token) {
    logDenial(site, "missing-token", { actor: null });
    return { ok: false, kind: "missing-token" };
  }

  let principal: VerifiedPrincipal;
  try {
    principal = await verify(token);
  } catch (err) {
    if (err instanceof AuthUnavailableError) {
      logDenial(site, "auth-unavailable", {
        actor: null,
        detail: { cause: describeJwksFailure(err.cause) },
      });
      return { ok: false, kind: "auth-unavailable" };
    }
    if (err instanceof ForbiddenError) {
      logDenial(site, "forbidden", {
        actor: err.sub,
        detail: { requiredRole: err.requiredRole },
      });
      return { ok: false, kind: "forbidden" };
    }
    const reason =
      err instanceof UnauthorizedError
        ? err.reason
        : err instanceof Error
          ? err.name
          : "verify-failed";
    logDenial(site, "unauthorized", { actor: null, reason });
    return { ok: false, kind: "unauthorized" };
  }

  return { ok: true, principal };
}

export function logWsAttach(
  sub: string,
  site: WsAuthSite,
  sinceConnectMs?: number,
): void {
  securityLog("info", "relay.attach", {
    category: "privileged",
    actor: sub,
    actorKind: "user",
    surface: "ws",
    ...(site.agentId !== undefined ? { agentId: site.agentId } : {}),
    result: "success",
    sourceIp: site.sourceIp,
    detail: {
      relay: site.relay,
      ...(sinceConnectMs !== undefined ? { sinceConnectMs } : {}),
    },
  });
}
