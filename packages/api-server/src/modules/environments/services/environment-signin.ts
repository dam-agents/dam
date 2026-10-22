import crypto from "node:crypto";
import type { TtlStore } from "../../../core/ttl-store.js";
import { err, ok, type Result } from "../../../core/result.js";
import {
  safeNext,
  type EnvironmentSession,
  type PendingEnvironmentLogin,
} from "../domain/gate.js";

export interface SignInIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  nonce: string | null;
}

export interface SignInProvider {
  authorizeUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
  }): string;
  redeemCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<Result<SignInIdentity, string>>;
  endSessionUrl(input: { postLogoutRedirectUri: string }): string;
}

interface Handoff {
  sub: string;
  email: string | null;
  address: string;
  next: string;
}

export type SignInFailure =
  | { reason: "unknown-state" }
  | { reason: "nonce-mismatch" }
  | { reason: "provider"; detail: string };

export interface EnvironmentSignIn {
  begin(address: string, next: string | undefined): Promise<string>;
  complete(
    state: string,
    code: string,
  ): Promise<Result<{ handoffUrl: string }, SignInFailure>>;
  redeemHandoff(
    code: string,
    address: string,
  ): Promise<{
    sessionId: string;
    session: EnvironmentSession;
    next: string;
  } | null>;
  session(sessionId: string): Promise<EnvironmentSession | null>;
  end(sessionId: string): Promise<void>;
  signOutUrl(): string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Sign-in to Environment addresses. It happens once,
 * on the fixed sign-in host under the environments domain, with an identity
 * provider client of its own whose tokens the platform's API refuses (they
 * carry no API audience). The sign-in host then hands the address the visitor
 * came from a code that works once, for that address only, within a minute;
 * the address trades it for a session of its own. So no token and no session
 * of one address is ever usable on another, and the identity provider's
 * redirect list names one host however many Environments there are.
 */
export function createEnvironmentSignIn(deps: {
  provider: SignInProvider;
  pending: TtlStore<PendingEnvironmentLogin>;
  handoffs: TtlStore<Handoff>;
  sessions: TtlStore<EnvironmentSession>;
  addressUrl: (address: string) => string;
  signInUrl: string;
  now: () => number;
}): EnvironmentSignIn {
  const random = (bytes: number) =>
    crypto.randomBytes(bytes).toString("base64url");

  return {
    async begin(address, next) {
      const state = random(24);
      const nonce = random(24);
      const codeVerifier = random(32);
      await deps.pending.set(state, {
        codeVerifier,
        nonce,
        address,
        next: safeNext(next),
        createdAt: deps.now(),
      });
      return deps.provider.authorizeUrl({
        state,
        nonce,
        codeChallenge: crypto
          .createHash("sha256")
          .update(codeVerifier)
          .digest("base64url"),
      });
    },

    async complete(state, code) {
      const login = await deps.pending.consume(state);
      if (!login) return err({ reason: "unknown-state" });
      const identity = await deps.provider.redeemCode({
        code,
        codeVerifier: login.codeVerifier,
      });
      if (!identity.ok)
        return err({ reason: "provider", detail: identity.error });
      if (identity.value.nonce !== login.nonce)
        return err({ reason: "nonce-mismatch" });
      const handoff = random(32);
      await deps.handoffs.set(handoff, {
        sub: identity.value.sub,
        email: identity.value.emailVerified ? identity.value.email : null,
        address: login.address,
        next: login.next,
      });
      const url = new URL("/.platform/session", deps.addressUrl(login.address));
      url.searchParams.set("code", handoff);
      return ok({ handoffUrl: url.href });
    },

    async redeemHandoff(code, address) {
      const handoff = await deps.handoffs.consume(code);
      if (!handoff || handoff.address !== address) return null;
      const sessionId = random(32);
      const session: EnvironmentSession = {
        sub: handoff.sub,
        email: handoff.email,
        address,
        createdAt: deps.now(),
      };
      await deps.sessions.set(sessionId, session);
      return { sessionId, session, next: handoff.next };
    },

    session(sessionId) {
      return deps.sessions.peek(sessionId);
    },

    end(sessionId) {
      return deps.sessions.delete(sessionId);
    },

    signOutUrl() {
      return deps.provider.endSessionUrl({
        postLogoutRedirectUri: new URL("/.platform/signed-out", deps.signInUrl)
          .href,
      });
    },
  };
}
