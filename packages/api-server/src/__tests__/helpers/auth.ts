const KEYCLOAK_URL = "http://keycloak.localtest.me:5555";
const REALM = "platform";
const CLIENT_ID = "platform-ui";

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/** Get an access token from Keycloak using the resource owner password grant. */
export async function getToken(
  username = "dev",
  password = "dev",
): Promise<string> {
  const res = await fetch(
    `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: CLIENT_ID,
        username,
        password,
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to get token: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as TokenResponse;
  return data.access_token;
}

/** Wait for Keycloak to be reachable and the realm to be provisioned. */
export async function waitForKeycloak(timeoutMs = 120_000) {
  const url = `${KEYCLOAK_URL}/realms/${REALM}/.well-known/openid-configuration`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Keycloak realm not ready after ${timeoutMs}ms`);
}
