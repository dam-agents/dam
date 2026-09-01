import type { User } from "oidc-client-ts";

/**
 * Stands in for `src/auth.ts` so the prototype runs with no Keycloak. Mirrors
 * that module's exports exactly — a missing one fails the build, which is the
 * behaviour we want.
 */
export const mockUser = {
  access_token: "mock-access-token",
  expired: false,
  profile: {
    sub: "mock-user-001",
    name: "Sample User",
    preferred_username: "sample-user",
    email: "sample.user@example.com",
  },
} as unknown as User;

export function getAuthConfig() {
  return { issuer: "mock", clientId: "mock" };
}

export async function initAuth(): Promise<User | null> {
  return mockUser;
}

export async function getAccessToken(): Promise<string> {
  return "mock-access-token";
}

export function getUser(): User | null {
  return mockUser;
}

export async function logout(): Promise<void> {}

export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return fetch(input, init);
}
