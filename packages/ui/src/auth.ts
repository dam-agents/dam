import { authConfigSchema } from "api-server-api";
import { type User, UserManager, WebStorageStateStore } from "oidc-client-ts";

import { rememberReturnPath, takeReturnPath } from "./lib/return-path.js";
import { readStoredTheme } from "./modules/platform/store/theme.js";
import { draftWriter } from "./modules/sessions/lib/draft-snapshot.js";
import { removeAllUndelivered } from "./modules/sessions/lib/undelivered-store.js";

let userManager: UserManager;
let currentUser: User | null = null;

function signinExtraParams(): Record<string, string> {
  return { kc_theme: readStoredTheme() };
}

export async function initAuth(): Promise<User | null> {
  const res = await fetch("/api/auth/config");
  if (!res.ok) throw new Error("Failed to fetch auth config");
  const config = authConfigSchema.parse(await res.json());

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

  if (window.location.pathname === "/auth/callback") {
    try {
      currentUser = await userManager.signinRedirectCallback();
      window.history.replaceState({}, "", takeReturnPath("login"));
      return currentUser;
    } catch (err) {
      console.error("OIDC callback error:", err);
      window.history.replaceState({}, "", "/");
    }
  }

  currentUser = await userManager.getUser();
  if (currentUser && !currentUser.expired) {
    return currentUser;
  }

  rememberReturnPath("login");
  await userManager.signinRedirect({ extraQueryParams: signinExtraParams() });
  return null;
}

export async function getAccessToken(): Promise<string> {
  const user = await userManager.getUser();
  if (user && !user.expired) {
    return user.access_token;
  }

  try {
    const renewed = await userManager.signinSilent();
    currentUser = renewed;
    return renewed!.access_token;
  } catch {
    rememberReturnPath("login");
    await userManager.signinRedirect({ extraQueryParams: signinExtraParams() });
    throw new Error("Session expired");
  }
}

export function getUser(): User | null {
  return currentUser;
}

export async function logout(): Promise<void> {
  draftWriter.clearAll();
  removeAllUndelivered();
  await userManager.signoutRedirect();
}

export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
