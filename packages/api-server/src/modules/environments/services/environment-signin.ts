import crypto from "node:crypto";
import type { TtlStore } from "../../../core/ttl-store.js";
import {
  safeNext,
  signInBinding,
  type EnvironmentSession,
} from "../domain/gate.js";

// UNIT_BOUNDARY_DESCRIPTION: who the share host signed in, as the front door hands them to an address: their subject, the email their identity provider verified, or null, and the share host's session that signed them in.
export interface Visitor {
  sub: string;
  email: string | null;
  shareSession: string;
}

interface Handoff extends Visitor {
  address: string;
  next: string;
  binding: string;
  then: string | null;
}

// UNIT_BOUNDARY_DESCRIPTION: the rest of one sign-in, for an Environment with more than one endpoint: whose it is, the endpoints still to get a session, and where the visitor returns once they all have one.
interface Chain {
  sub: string;
  shareSession: string;
  remaining: string[];
  returnTo: string;
}

// UNIT_BOUNDARY_DESCRIPTION: the share host's sessions, as an address's session depends on them: whether one still holds, and ending one.
export interface ShareSessions {
  alive(sessionId: string): Promise<boolean>;
  end(sessionId: string): Promise<void>;
}

export interface EnvironmentSignIn {
  handoff(
    visitor: Visitor,
    address: string,
    next: string | undefined,
    binding: string,
    then?: string,
  ): Promise<string>;
  startChain(
    visitor: Visitor,
    others: string[],
    returnTo: string,
  ): Promise<string | null>;
  continueChain(
    chainId: string,
    visitor: Visitor,
    address: string,
  ): Promise<string | null>;
  redeemHandoff(
    code: string,
    address: string,
    secret: string,
  ): Promise<{
    sessionId: string;
    session: EnvironmentSession;
    next: string;
  } | null>;
  completeSignIn(
    sessionId: string,
    session: EnvironmentSession,
    others: string[],
    returnTo: string,
  ): Promise<{ hop: string; missing: string[] } | null>;
  session(sessionId: string): Promise<EnvironmentSession | null>;
  signOut(sessionId: string): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Sessions on Environment addresses. An address
 * without a session gives the visitor's browser a sign-in secret and sends the
 * secret's hash to the share host's front door, which signs the visitor in
 * with its own session and identity provider client and hands the address a
 * code that works once, for that address and that browser only, within a
 * minute; the address trades it for a session of its own. So a code that
 * leaks, through a log, the history or a referrer, opens nothing in another
 * browser, and no session of one address is ever usable on another. The
 * session lasts only while the share host's session it came from does, and
 * signing out of it ends both. An Environment with several endpoints is one
 * sign-in: once the first address has its session, the visitor's browser
 * passes through each other endpoint in turn, which gets a session of its own
 * the same way, bound to a secret of its own, and then returns where it began.
 * So an app whose pages call another of its endpoints, such as its own login
 * server, finds a session there. A sign-in that left an endpoint without a
 * session, or an endpoint whose session is gone while another's holds, is
 * completed on the next page load of an endpoint that has one: the browser
 * passes through the endpoints that miss one, once per session in the time a
 * chain lasts, so a step that keeps failing never loops.
 */
export function createEnvironmentSignIn(deps: {
  handoffs: TtlStore<Handoff>;
  sessions: TtlStore<EnvironmentSession>;
  chains: TtlStore<Chain>;
  signedIn: TtlStore<string>;
  completions: TtlStore<string[]>;
  share: ShareSessions;
  addressUrl: (address: string) => string;
  now: () => number;
}): EnvironmentSignIn {
  const random = (bytes: number) =>
    crypto.randomBytes(bytes).toString("base64url");
  const chainHop = (address: string, chainId: string) => {
    const url = new URL("/.platform/signin", deps.addressUrl(address));
    url.searchParams.set("chain", chainId);
    return url.href;
  };
  const signedInKey = (shareSession: string, address: string) =>
    `${shareSession}:${address}`;

  async function startChain(
    visitor: Pick<Visitor, "sub" | "shareSession">,
    others: string[],
    returnTo: string,
  ): Promise<string | null> {
    if (others.length === 0) return null;
    const chainId = random(32);
    await deps.chains.set(chainId, {
      sub: visitor.sub,
      shareSession: visitor.shareSession,
      remaining: others,
      returnTo,
    });
    return chainHop(others[0]!, chainId);
  }

  return {
    async handoff(visitor, address, next, binding, then) {
      const code = random(32);
      await deps.handoffs.set(code, {
        sub: visitor.sub,
        email: visitor.email,
        shareSession: visitor.shareSession,
        address,
        next: safeNext(next),
        binding,
        then: then ?? null,
      });
      const url = new URL("/.platform/session", deps.addressUrl(address));
      url.searchParams.set("code", code);
      return url.href;
    },

    async redeemHandoff(code, address, secret) {
      const handoff = await deps.handoffs.consume(code);
      if (
        !handoff ||
        handoff.address !== address ||
        handoff.binding !== signInBinding(secret)
      )
        return null;
      const sessionId = random(32);
      const session: EnvironmentSession = {
        sub: handoff.sub,
        email: handoff.email,
        address,
        shareSession: handoff.shareSession,
        createdAt: deps.now(),
      };
      await deps.sessions.set(sessionId, session);
      await deps.signedIn.set(
        signedInKey(session.shareSession, address),
        sessionId,
      );
      return { sessionId, session, next: handoff.then ?? handoff.next };
    },

    startChain,

    async completeSignIn(sessionId, session, others, returnTo) {
      if (await deps.completions.peek(sessionId)) return null;
      const missing: string[] = [];
      for (const address of others) {
        const id = await deps.signedIn.peek(
          signedInKey(session.shareSession, address),
        );
        if (id === null || (await deps.sessions.peek(id)) === null)
          missing.push(address);
      }
      if (missing.length === 0) return null;
      await deps.completions.set(sessionId, missing);
      const hop = await startChain(session, missing, returnTo);
      return hop === null ? null : { hop, missing };
    },

    async continueChain(chainId, visitor, address) {
      const chain = await deps.chains.peek(chainId);
      if (
        !chain ||
        chain.sub !== visitor.sub ||
        chain.shareSession !== visitor.shareSession ||
        chain.remaining[0] !== address
      )
        return null;
      const rest = chain.remaining.slice(1);
      if (rest.length === 0) {
        await deps.chains.delete(chainId);
        return chain.returnTo;
      }
      await deps.chains.set(chainId, { ...chain, remaining: rest });
      return chainHop(rest[0]!, chainId);
    },

    async session(sessionId) {
      const session = await deps.sessions.peek(sessionId);
      if (!session) return null;
      if (await deps.share.alive(session.shareSession)) return session;
      await deps.sessions.delete(sessionId);
      return null;
    },

    async signOut(sessionId) {
      const session = await deps.sessions.peek(sessionId);
      await deps.sessions.delete(sessionId);
      if (session) await deps.share.end(session.shareSession);
    },
  };
}
