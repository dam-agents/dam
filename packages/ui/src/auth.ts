import { type AuthConfig, authConfigSchema } from "api-server-api";
import { type User, UserManager, WebStorageStateStore } from "oidc-client-ts";

import { readStoredTheme } from "./modules/platform/store/theme.js";

let userManager: UserManager;
let currentUser: User | null = null;

let cachedAuthConfig: AuthConfig | null = null;

/**
 * The Keycloak theme runs on a different host than the UI so it can't read
 * localStorage directly. We hand the current preference off as an OIDC
 * extra query param (`kc_theme`); the theme picks it up pre-hydration and
 * applies `.dark` on <html> without a light/dark flash. See ADR-054.
 */
function signinExtraParams(): Record<string, string> {
  return { kc_theme: readStoredTheme() };
}

async function fetchAuthConfig(): Promise<AuthConfig> {
  const res = await fetch("/api/auth/config");
  if (!res.ok) throw new Error("Failed to fetch auth config");
  // `.parse()` — broken auth config is unrecoverable (the OIDC client
  // can't be constructed from a malformed response), so fail loud rather
  // than silently fall back.
  const parsed = authConfigSchema.parse(await res.json());
  cachedAuthConfig = parsed;
  return parsed;
}

/** Returns the auth config — must be called after initAuth(). */
export function getAuthConfig(): AuthConfig | null {
  return cachedAuthConfig;
}

/**
 * Initialize OIDC authentication. Must be called before rendering the app.
 * Returns the authenticated user, or null if a redirect to Keycloak is in progress.
 */
export async function initAuth(): Promise<User | null> {
  const config = await fetchAuthConfig();

  userManager = new UserManager({
    authority: config.issuer,
    client_id: config.clientId,
    redirect_uri: `${window.location.origin}/auth/callback`,
    post_logout_redirect_uri: `${window.location.origin}/`,
    response_type: "code",
    scope: "openid profile",
    userStore: new WebStorageStateStore({ store: sessionStorage }),
    automaticSilentRenew: true,
  });

  // Handle OIDC callback
  if (window.location.pathname === "/auth/callback") {
    try {
      currentUser = await userManager.signinRedirectCallback();
      const returnUrl = sessionStorage.getItem("platform-auth-return") || "/";
      sessionStorage.removeItem("platform-auth-return");
      window.history.replaceState({}, "", returnUrl);
      return currentUser;
    } catch (err) {
      console.error("OIDC callback error:", err);
      window.history.replaceState({}, "", "/");
    }
  }

  // Check existing session
  currentUser = await userManager.getUser();
  if (currentUser && !currentUser.expired) {
    return currentUser;
  }

  // Not authenticated — save current location and redirect to Keycloak
  sessionStorage.setItem(
    "platform-auth-return",
    window.location.pathname + window.location.search,
  );
  await userManager.signinRedirect({ extraQueryParams: signinExtraParams() });
  return null;
}

/** Returns a valid access token, refreshing if needed. */
export async function getAccessToken(): Promise<string> {
  const user = await userManager.getUser();
  if (user && !user.expired) {
    return user.access_token;
  }

  // Try silent renew
  try {
    const renewed = await userManager.signinSilent();
    currentUser = renewed;
    return renewed!.access_token;
  } catch {
    // Silent renew failed — redirect to login
    await userManager.signinRedirect({ extraQueryParams: signinExtraParams() });
    throw new Error("Session expired");
  }
}

/** Returns the current authenticated user (or null before initAuth). */
export function getUser(): User | null {
  return currentUser;
}

/** Redirect to Keycloak logout. */
export async function logout(): Promise<void> {
  await userManager.signoutRedirect();
}

/** Fetch wrapper that injects the Authorization header. */
export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
