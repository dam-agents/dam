import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

let userManager: UserManager;
let currentUser: User | null = null;

interface AuthConfig {
  issuer: string;
  clientId: string;
}

let cachedAuthConfig: AuthConfig | null = null;

async function fetchAuthConfig(): Promise<AuthConfig> {
  const res = await fetch("/api/auth/config");
  if (!res.ok) throw new Error("Failed to fetch auth config");
  cachedAuthConfig = await res.json();
  return cachedAuthConfig!;
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
  await userManager.signinRedirect();
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
    await userManager.signinRedirect();
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
