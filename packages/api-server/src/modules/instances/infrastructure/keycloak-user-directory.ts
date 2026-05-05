export interface KeycloakUserDirectory {
  resolveByEmail(email: string): Promise<string | null>;
  resolveBySub(sub: string): Promise<string | null>;
  resolveManyBySub(subs: string[]): Promise<Map<string, string>>;
}

export interface KeycloakUserDirectoryConfig {
  keycloakUrl: string;
  keycloakRealm: string;
  clientId: string;
  clientSecret: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface CachedLookup {
  email: string | null;
  expiresAt: number;
}

const TOKEN_MARGIN_SECONDS = 30;
const LOOKUP_TTL_MS = 60_000;

export function createKeycloakUserDirectory(config: KeycloakUserDirectoryConfig): KeycloakUserDirectory {
  let tokenCache: CachedToken | null = null;
  const subToEmailCache = new Map<string, CachedLookup>();
  const emailToSubCache = new Map<string, CachedLookup>();

  async function getAdminToken(): Promise<string> {
    const now = Date.now() / 1000;
    if (tokenCache && tokenCache.expiresAt > now + TOKEN_MARGIN_SECONDS) {
      return tokenCache.accessToken;
    }
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
    const res = await fetch(`${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Keycloak admin token request failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in?: number };
    const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in ?? 60);
    tokenCache = { accessToken: data.access_token, expiresAt };
    return data.access_token;
  }

  async function adminFetch(path: string): Promise<Response> {
    const token = await getAdminToken();
    return fetch(`${config.keycloakUrl}/admin/realms/${config.keycloakRealm}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  return {
    async resolveByEmail(email) {
      const now = Date.now();
      const cached = emailToSubCache.get(email);
      if (cached && cached.expiresAt > now) return cached.email;

      const query = new URLSearchParams({ email, exact: "true" });
      const res = await adminFetch(`/users?${query}`);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Keycloak user lookup by email failed: ${res.status} ${body}`);
      }
      const users = (await res.json()) as Array<{ id: string; email?: string }>;
      const sub = users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
      emailToSubCache.set(email, { email: sub, expiresAt: now + LOOKUP_TTL_MS });
      if (sub) {
        const lookedUp = users.find((u) => u.id === sub);
        if (lookedUp?.email) {
          subToEmailCache.set(sub, { email: lookedUp.email, expiresAt: now + LOOKUP_TTL_MS });
        }
      }
      return sub;
    },

    async resolveBySub(sub) {
      const now = Date.now();
      const cached = subToEmailCache.get(sub);
      if (cached && cached.expiresAt > now) return cached.email;

      try {
        const res = await adminFetch(`/users/${encodeURIComponent(sub)}`);
        if (!res.ok) {
          process.stderr.write(`[keycloak-user-directory] resolveBySub ${sub} failed: ${res.status}\n`);
          subToEmailCache.set(sub, { email: null, expiresAt: now + LOOKUP_TTL_MS });
          return null;
        }
        const user = (await res.json()) as { id: string; email?: string };
        const email = user.email ?? null;
        subToEmailCache.set(sub, { email, expiresAt: now + LOOKUP_TTL_MS });
        return email;
      } catch (err) {
        process.stderr.write(`[keycloak-user-directory] resolveBySub ${sub} errored: ${err}\n`);
        return null;
      }
    },

    async resolveManyBySub(subs) {
      const result = new Map<string, string>();
      const missing: string[] = [];
      const now = Date.now();
      for (const sub of subs) {
        const cached = subToEmailCache.get(sub);
        if (cached && cached.expiresAt > now) {
          if (cached.email) result.set(sub, cached.email);
          continue;
        }
        missing.push(sub);
      }
      await Promise.all(
        missing.map(async (sub) => {
          const email = await this.resolveBySub(sub);
          if (email) result.set(sub, email);
        }),
      );
      return result;
    },
  };
}
