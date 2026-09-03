import { jwtVerify, type JWTVerifyGetKey } from "jose";

import { err, ok } from "../../../core/result.js";
import type { ShareIdentityProvider } from "../services/share-auth-service.js";

export interface KeycloakShareIdentityConfig {
  keycloakExternalUrl: string;
  keycloakUrl: string;
  realm: string;
  clientId: string;
  callbackUrl: string;
}

export function keycloakShareJwksUrl(cfg: {
  keycloakUrl: string;
  realm: string;
}): URL {
  return new URL(
    `${cfg.keycloakUrl}/realms/${cfg.realm}/protocol/openid-connect/certs`,
  );
}

export function createKeycloakShareIdentity(
  cfg: KeycloakShareIdentityConfig,
  deps: { fetch: typeof fetch; idTokenKey: JWTVerifyGetKey },
): ShareIdentityProvider {
  const externalRealm = `${cfg.keycloakExternalUrl}/realms/${cfg.realm}`;
  const internalRealm = `${cfg.keycloakUrl}/realms/${cfg.realm}`;
  const { idTokenKey } = deps;

  return {
    authorizeUrl({ state, nonce, codeChallenge }) {
      const url = new URL(`${externalRealm}/protocol/openid-connect/auth`);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: cfg.clientId,
        redirect_uri: cfg.callbackUrl,
        scope: "openid email",
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      }).toString();
      return url.href;
    },

    async redeemCode({ code, codeVerifier }) {
      const res = await deps.fetch(
        `${internalRealm}/protocol/openid-connect/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: cfg.callbackUrl,
            client_id: cfg.clientId,
            code_verifier: codeVerifier,
          }),
        },
      );
      if (!res.ok)
        return err(`token exchange failed: ${res.status} ${await res.text()}`);
      const tokens = (await res.json()) as { id_token?: unknown };
      if (typeof tokens.id_token !== "string")
        return err("token response has no id_token");
      try {
        const { payload } = await jwtVerify(tokens.id_token, idTokenKey, {
          issuer: externalRealm,
          audience: cfg.clientId,
        });
        if (typeof payload.sub !== "string") return err("id_token has no sub");
        return ok({
          sub: payload.sub,
          email: typeof payload.email === "string" ? payload.email : null,
          emailVerified: payload.email_verified === true,
          nonce: typeof payload.nonce === "string" ? payload.nonce : null,
        });
      } catch (e) {
        return err(
          `id_token verification failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },

    endSessionUrl({ postLogoutRedirectUri }) {
      const url = new URL(`${externalRealm}/protocol/openid-connect/logout`);
      url.search = new URLSearchParams({
        client_id: cfg.clientId,
        post_logout_redirect_uri: postLogoutRedirectUri,
      }).toString();
      return url.href;
    },
  };
}
