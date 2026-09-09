import crypto from "node:crypto";

import type { TtlStore } from "../../../core/ttl-store.js";
import { err, ok, type Result } from "../../../core/result.js";
import {
  safeNextOrRoot,
  type PendingLogin,
  type ShareSession,
} from "../domain/share-session.js";

export interface ShareIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  nonce: string | null;
}

export interface ShareIdentityProvider {
  authorizeUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
  }): string;
  redeemCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<Result<ShareIdentity, string>>;
  endSessionUrl(input: { postLogoutRedirectUri: string }): string;
}

export type ShareLoginFailure =
  | { reason: "unknown-state" }
  | { reason: "nonce-mismatch" }
  | { reason: "provider"; detail: string };

export interface ShareAuthService {
  beginLogin(next: string | undefined): Promise<string>;
  completeLogin(
    state: string,
    code: string,
  ): Promise<Result<{ sessionId: string; next: string }, ShareLoginFailure>>;
  getSession(sessionId: string): Promise<ShareSession | null>;
  endSession(sessionId: string): Promise<void>;
  logoutUrl(next: string | undefined): string;
}

export function createShareAuthService(deps: {
  provider: ShareIdentityProvider;
  pending: TtlStore<PendingLogin>;
  sessions: TtlStore<ShareSession>;
  shareBaseUrl: string;
  now: () => number;
}): ShareAuthService {
  const { provider, pending, sessions, now } = deps;
  const shareBase = deps.shareBaseUrl.replace(/\/+$/, "");

  return {
    async beginLogin(next) {
      const state = crypto.randomBytes(24).toString("base64url");
      const nonce = crypto.randomBytes(24).toString("base64url");
      const codeVerifier = crypto.randomBytes(32).toString("base64url");
      const codeChallenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");
      await pending.set(state, {
        codeVerifier,
        nonce,
        next: safeNextOrRoot(next),
        createdAt: now(),
      });
      return provider.authorizeUrl({ state, nonce, codeChallenge });
    },

    async completeLogin(state, code) {
      const login = await pending.consume(state);
      if (!login) return err({ reason: "unknown-state" });
      const identity = await provider.redeemCode({
        code,
        codeVerifier: login.codeVerifier,
      });
      if (!identity.ok)
        return err({ reason: "provider", detail: identity.error });
      if (identity.value.nonce !== login.nonce)
        return err({ reason: "nonce-mismatch" });
      const sessionId = crypto.randomBytes(32).toString("base64url");
      await sessions.set(sessionId, {
        sub: identity.value.sub,
        email: identity.value.email,
        emailVerified: identity.value.emailVerified,
        createdAt: now(),
      });
      return ok({ sessionId, next: login.next });
    },

    getSession(sessionId) {
      return sessions.peek(sessionId);
    },

    endSession(sessionId) {
      return sessions.delete(sessionId);
    },

    logoutUrl(next) {
      const login = new URL(`${shareBase}/auth/login`);
      login.searchParams.set("next", safeNextOrRoot(next));
      return provider.endSessionUrl({ postLogoutRedirectUri: login.href });
    },
  };
}
