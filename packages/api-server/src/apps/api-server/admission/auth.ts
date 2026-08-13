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

export class UnauthorizedError extends Error {
  constructor(public readonly reason: string) {
    super(`Unauthorized: ${reason}`);
    this.name = "UnauthorizedError";
  }
}

export class AuthUnavailableError extends Error {
  readonly reason = "jwks-unavailable";
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
  issuerUrl: string;
  jwksUrl: string;
  audience?: string;
  requiredRole?: string;
  uiClientId: string;
  cliClientId: string;
  coreRole?: string;
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
  | "missing-token"
  | "auth-unavailable"
  | "unauthorized"
  | "forbidden";

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
