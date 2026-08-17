export interface KeycloakUserDirectory {
  resolveByEmail(email: string): Promise<string | null>;
  resolveBySub(sub: string): Promise<string | null>;
  resolveDisplayNameBySub(sub: string): Promise<string | null>;
  resolveManyBySub(subs: string[]): Promise<Map<string, string>>;
  isActive(sub: string): Promise<boolean>;
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

export interface DirectoryUser {
  email: string | null;
  displayName: string | null;
}

interface CachedUser {
  user: DirectoryUser | null;
  expiresAt: number;
}

interface CachedLookup {
  email: string | null;
  expiresAt: number;
}

export interface KeycloakUserRecord {
  email?: string;
  firstName?: string;
  lastName?: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Keycloak keeps the given and family name in
 * separate fields and either can be missing, so the display name is whatever
 * parts exist joined by a space. A record with neither has no display name at
 * all — callers must render nothing rather than fall back to the email, which
 * is a real mailbox and would leak on the unauthenticated Public Agent Page.
 */
export function toDirectoryUser(record: KeycloakUserRecord): DirectoryUser {
  const parts = [record.firstName, record.lastName]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part);
  return {
    email: record.email ?? null,
    displayName: parts.length > 0 ? parts.join(" ") : null,
  };
}

const TOKEN_MARGIN_SECONDS = 30;
const LOOKUP_TTL_MS = 60_000;

export function createKeycloakUserDirectory(
  config: KeycloakUserDirectoryConfig,
): KeycloakUserDirectory {
  let tokenCache: CachedToken | null = null;
  const subCache = new Map<string, CachedUser>();
  const emailToSubCache = new Map<string, CachedLookup>();

  function cachePut<T>(cache: Map<string, T>, key: string, value: T): void {
    if (cache.size >= 10_000) cache.clear();
    cache.set(key, value);
  }

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
    const res = await fetch(
      `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Keycloak admin token request failed: ${res.status} ${body}`,
      );
    }
    const data = (await res.json()) as {
      access_token: string;
      expires_in?: number;
    };
    const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in ?? 60);
    tokenCache = { accessToken: data.access_token, expiresAt };
    return data.access_token;
  }

  async function adminFetch(path: string): Promise<Response> {
    const token = await getAdminToken();
    return fetch(
      `${config.keycloakUrl}/admin/realms/${config.keycloakRealm}${path}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
  }

  async function fetchUser(sub: string): Promise<DirectoryUser | null> {
    const now = Date.now();
    const cached = subCache.get(sub);
    if (cached && cached.expiresAt > now) return cached.user;

    try {
      const res = await adminFetch(`/users/${encodeURIComponent(sub)}`);
      if (!res.ok) {
        process.stderr.write(
          `[keycloak-user-directory] user lookup ${sub} failed: ${res.status}\n`,
        );
        cachePut(subCache, sub, { user: null, expiresAt: now + LOOKUP_TTL_MS });
        return null;
      }
      const user = toDirectoryUser((await res.json()) as KeycloakUserRecord);
      cachePut(subCache, sub, { user, expiresAt: now + LOOKUP_TTL_MS });
      return user;
    } catch (err) {
      process.stderr.write(
        `[keycloak-user-directory] user lookup ${sub} errored: ${err}\n`,
      );
      return null;
    }
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
        throw new Error(
          `Keycloak user lookup by email failed: ${res.status} ${body}`,
        );
      }
      const users = (await res.json()) as Array<
        { id: string } & KeycloakUserRecord
      >;
      const sub =
        users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ??
        null;
      cachePut(emailToSubCache, email, {
        email: sub,
        expiresAt: now + LOOKUP_TTL_MS,
      });
      if (sub) {
        const lookedUp = users.find((u) => u.id === sub);
        if (lookedUp) {
          cachePut(subCache, sub, {
            user: toDirectoryUser(lookedUp),
            expiresAt: now + LOOKUP_TTL_MS,
          });
        }
      }
      return sub;
    },

    async resolveBySub(sub) {
      return (await fetchUser(sub))?.email ?? null;
    },

    async resolveDisplayNameBySub(sub) {
      return (await fetchUser(sub))?.displayName ?? null;
    },

    async isActive(sub) {
      const res = await adminFetch(`/users/${encodeURIComponent(sub)}`);
      if (res.status === 404) return false;
      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `Keycloak user lookup by sub failed: ${res.status} ${body}`,
        );
      }
      const user = (await res.json()) as { enabled?: boolean };
      return user.enabled !== false;
    },

    async resolveManyBySub(subs) {
      const result = new Map<string, string>();
      await Promise.all(
        subs.map(async (sub) => {
          const email = (await fetchUser(sub))?.email;
          if (email) result.set(sub, email);
        }),
      );
      return result;
    },
  };
}
