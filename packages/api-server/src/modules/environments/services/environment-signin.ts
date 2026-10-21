import crypto from "node:crypto";
import type { TtlStore } from "../../../core/ttl-store.js";
import { safeNext, type EnvironmentSession } from "../domain/gate.js";

// UNIT_BOUNDARY_DESCRIPTION: who the share host signed in, as the front door hands them to an address: their subject and the email their identity provider verified, or null.
export interface Visitor {
  sub: string;
  email: string | null;
}

interface Handoff extends Visitor {
  address: string;
  next: string;
}

export interface EnvironmentSignIn {
  handoff(
    visitor: Visitor,
    address: string,
    next: string | undefined,
  ): Promise<string>;
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
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Sessions on Environment addresses. The share
 * host signs a visitor in, with its own session and identity provider client,
 * and hands the address they came for a code that works once, for that
 * address only, within a minute; the address trades it for a session of its
 * own. So no session of one address is ever usable on another, and an
 * Environment needs no identity provider client or sign-in host of its own.
 */
export function createEnvironmentSignIn(deps: {
  handoffs: TtlStore<Handoff>;
  sessions: TtlStore<EnvironmentSession>;
  addressUrl: (address: string) => string;
  now: () => number;
}): EnvironmentSignIn {
  const random = (bytes: number) =>
    crypto.randomBytes(bytes).toString("base64url");

  return {
    async handoff(visitor, address, next) {
      const code = random(32);
      await deps.handoffs.set(code, {
        sub: visitor.sub,
        email: visitor.email,
        address,
        next: safeNext(next),
      });
      const url = new URL("/.platform/session", deps.addressUrl(address));
      url.searchParams.set("code", code);
      return url.href;
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
  };
}
