import { createRemoteJWKSet, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";
import type { UserIdentity } from "api-server-api";
import { emit, EventType } from "../../events.js";

export class ForbiddenError extends Error {
  constructor(public readonly requiredRole: string) {
    super(`Missing required role: ${requiredRole}`);
  }
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
}

const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/auth/config",
  "/api/oauth/callback",
  "/api/slack/oauth/callback",
  "/api/telegram/oauth/callback",
]);

export function createAuth(config: AuthConfig) {
  const JWKS = createRemoteJWKSet(new URL(config.jwksUrl));

  async function verify(token: string): Promise<UserIdentity> {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: config.issuerUrl,
      audience: config.audience,
      algorithms: ["RS256"],
    });

    if (config.requiredRole) {
      const realmAccess = (payload as Record<string, unknown>).realm_access as
        | { roles?: string[] }
        | undefined;
      if (!realmAccess?.roles?.includes(config.requiredRole)) {
        throw new ForbiddenError(config.requiredRole);
      }
    }

    return {
      sub: payload.sub!,
      preferredUsername:
        (payload as Record<string, unknown>).preferred_username as string ??
        payload.sub!,
    };
  }

  const middleware: MiddlewareHandler = async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path)) return next();

    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }

    try {
      const jwt = authHeader.slice(7);
      const user = await verify(jwt);
      c.set("user", user);
      emit({ type: EventType.UserAuthenticated, userSub: user.sub, userJwt: jwt });
      return next();
    } catch (err) {
      if (err instanceof ForbiddenError) {
        return c.json({ error: "forbidden", message: "Access pending approval. Contact your administrator." }, 403);
      }
      return c.json({ error: "unauthorized" }, 401);
    }
  };

  return { middleware, verify };
}
