import {
  keycloakClientId,
  keycloakRealm,
  keycloakUrl,
  testUser,
} from "../config.js";

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
