import crypto from "node:crypto";

export interface KeycloakOAuthConfig {
  keycloakExternalUrl: string;
  keycloakUrl: string;
  keycloakRealm: string;
  keycloakClientId: string;
  callbackUrl: string;
}

export interface PkcePair {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

export interface TokenExchangeResult {
  keycloakSub: string;
}

export function generatePkce(): PkcePair {
  const state = crypto.randomUUID();
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { state, codeVerifier, codeChallenge };
}

export function buildAuthorizeUrl(
  cfg: KeycloakOAuthConfig,
  state: string,
  codeChallenge: string,
): string {
  const authEndpoint = `${cfg.keycloakExternalUrl}/realms/${cfg.keycloakRealm}/protocol/openid-connect/auth`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.keycloakClientId,
    redirect_uri: cfg.callbackUrl,
    state,
    scope: "openid",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${authEndpoint}?${params}`;
}

export async function exchangeCodeForTokens(
  cfg: KeycloakOAuthConfig,
  code: string,
  codeVerifier: string,
): Promise<TokenExchangeResult | { error: string }> {
  const tokenEndpoint = `${cfg.keycloakUrl}/realms/${cfg.keycloakRealm}/protocol/openid-connect/token`;
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.callbackUrl,
      client_id: cfg.keycloakClientId,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { error: `token exchange failed: ${res.status} ${body}` };
  }

  const tokenData = (await res.json()) as {
    access_token: string;
  };

  const payload = JSON.parse(
    Buffer.from(tokenData.access_token.split(".")[1], "base64url").toString(),
  ) as { sub: string };

  return {
    keycloakSub: payload.sub,
  };
}
