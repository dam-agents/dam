import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Context, MiddlewareHandler } from "hono";
import type { UserIdentity } from "api-server-api";
import { emit, EventType } from "../../events.js";
import { securityLog } from "../../core/security-log.js";

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

const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/auth/config",
  "/api/oauth/callback",
  "/api/slack/oauth/callback",
  "/api/telegram/oauth/callback",
  "/api/terms",
]);

const PUBLIC_PATH_PREFIXES = ["/api/brand/"];

export function createAuth(config: AuthConfig) {
  const JWKS = createRemoteJWKSet(new URL(config.jwksUrl));

  async function verify(
    token: string,
  ): Promise<{ user: UserIdentity; azp: string; roles: string[] }> {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: config.issuerUrl,
      audience: config.audience,
      algorithms: ["RS256"],
    });

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
      },
      azp: typeof claims.azp === "string" ? claims.azp : "",
      roles,
    };
  }

  const middleware: MiddlewareHandler = async (c, next) => {
    if (
      PUBLIC_PATHS.has(c.req.path) ||
      PUBLIC_PATH_PREFIXES.some((p) => c.req.path.startsWith(p))
    )
      return next();

    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      securityLog("warn", "authn.deny", {
        category: "authn",
        actor: null,
        actorKind: "external",
        result: "failure",
        reason: "missing-bearer",
        target: c.req.path,
        sourceIp: clientIp(c),
      });
      return c.json({ error: "unauthorized" }, 401);
    }

    try {
      const jwt = authHeader.slice(7);
      const { user, azp, roles } = await verify(jwt);
      c.set("user", user);
      c.set("roles", roles);
      const surface =
        azp === config.uiClientId
          ? "ui"
          : azp === config.cliClientId
            ? "cli"
            : "other";
      const isCore = config.coreRole ? roles.includes(config.coreRole) : false;
      emit({
        type: EventType.UserAuthenticated,
        userSub: user.sub,
        surface,
        isCore,
      });
      return next();
    } catch (err) {
      if (err instanceof ForbiddenError) {
        // Known principal denied for lack of a required role — the most
        // forensically interesting authz event.
        securityLog("warn", "authz.deny", {
          category: "authz",
          actor: err.sub,
          actorKind: "user",
          result: "failure",
          reason: "missing-required-role",
          target: c.req.path,
          sourceIp: clientIp(c),
          detail: { requiredRole: err.requiredRole },
        });
        return c.json(
          {
            error: "forbidden",
            message: "Access pending approval. Contact your administrator.",
          },
          403,
        );
      }
      // Token present but invalid — log the verify-error class (never the
      // token itself): expired/bad-signature/wrong-audience are replay and
      // tampering signals.
      securityLog("warn", "authn.deny", {
        category: "authn",
        actor: null,
        actorKind: "external",
        result: "failure",
        reason: err instanceof Error ? err.name : "verify-failed",
        target: c.req.path,
        sourceIp: clientIp(c),
      });
      return c.json({ error: "unauthorized" }, 401);
    }
  };

  return { middleware, verify };
}
