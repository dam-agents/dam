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

const SAFE_NEXT = /^\/a\/[A-Za-z0-9_-]+(\/raw)?(\?[^#\s]*)?$/;

export function isSafeNext(path: string): boolean {
  return SAFE_NEXT.test(path);
}

export function safeNextOrRoot(path: string | undefined): string {
  return path !== undefined && isSafeNext(path) ? path : "/";
}
