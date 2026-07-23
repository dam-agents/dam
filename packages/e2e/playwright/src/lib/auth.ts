import {
  keycloakClientId,
  keycloakRealm,
  keycloakUrl,
  testUser,
} from "../config.js";
import type { ApiClient } from "./api-client.js";

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export async function getAccessToken(
  user: { username: string; password: string } = testUser,
): Promise<string> {
  const url = `${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: keycloakClientId,
      username: user.username,
      password: user.password,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Keycloak token request failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as TokenResponse;
  return data.access_token;
}

/** Accept the current Terms of Use for the client's user. The terms gate
 *  412s every non-terms API call until the user accepts, and only the UI
 *  login flow (01-auth) does it implicitly — self-contained API specs
 *  (extended suites) must call this before anything else. */
export async function acceptTerms(api: ApiClient): Promise<void> {
  const current = await api.terms.current.query();
  await api.terms.accept.mutate({ version: current.version });
}
