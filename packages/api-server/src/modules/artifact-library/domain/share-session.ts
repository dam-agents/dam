export interface ShareSessionCookie {
  name: string;
  secure: boolean;
}

export function shareSessionCookie(shareBaseUrl: string): ShareSessionCookie {
  const secure = new URL(shareBaseUrl).protocol === "https:";
  return {
    name: secure ? "__Host-share_session" : "share_session",
    secure,
  };
}

export const SHARE_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export const SHARE_LOGIN_TTL_MS = 5 * 60 * 1000;

export interface ShareSession {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  createdAt: number;
}

export interface PendingLogin {
  codeVerifier: string;
  nonce: string;
  next: string;
  createdAt: number;
}

// UNIT_BOUNDARY_DESCRIPTION: the pages a sign-in may return to on the share host: a shared artifact or its raw download, and an Environment's front door (`/e/<address>`, whose own `next` names a path on that address).
const SAFE_NEXT =
  /^\/(a\/[A-Za-z0-9_-]+(\/raw)?|e\/[a-z0-9-]{1,63})(\?[^#\s]*)?$/;

export function isSafeNext(path: string): boolean {
  return SAFE_NEXT.test(path);
}

export function safeNextOrRoot(path: string | undefined): string {
  return path !== undefined && isSafeNext(path) ? path : "/";
}
