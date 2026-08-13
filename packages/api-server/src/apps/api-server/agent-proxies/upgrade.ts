import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { URLPattern } from "node:url";
import type { UserIdentity } from "api-server-api";
import { getLogger } from "../../../core/logger.js";
import { securityLog } from "../../../core/security-log.js";
import type { IsAcceptedPort } from "../../../modules/terms/index.js";
import {
  hasAgentBinding,
  hasScope,
  logWsAttach,
  upgradeSourceIp,
  type Authenticate,
  type AuthDenialKind,
  type WsAuthSite,
} from "../admission/auth.js";
import {
  checkWsTermsAccepted,
  type TermsDenialKind,
} from "../admission/terms.js";
import { upgradeDenial } from "./mappers.js";

/** The authorization kinds this edge's own gates produce — ownership and
 *  operate-scope/binding. Semantic only; encoded in mappers.ts like the
 *  admission kinds. */
export type RelayDenialKind = "not-owner" | "not-permitted";

/** Everything a relay admission can refuse with — the union of the
 *  admission gates it composes plus its own authorization kinds. */
export type RelayAdmissionDenialKind =
  | AuthDenialKind
  | TermsDenialKind
  | RelayDenialKind;

export type RelayAdmissionResult =
  | { ok: true; user: UserIdentity }
  | { ok: false; kind: RelayAdmissionDenialKind };

export interface RelayAdmissionDeps {
  authenticate: Authenticate;
  verifyOwner: (agentId: string, ownerSub: string) => Promise<boolean>;
  isTermsAccepted: IsAcceptedPort;
}

/** Pure decision — no socket, no encoding: gates only, each with its audit
 *  log. The dispatch delivers the returned kind through the mapper. */
export type RelayAdmission = (
  req: IncomingMessage,
  url: URL,
  agentId: string,
  relayKind: string,
) => Promise<RelayAdmissionResult>;

/** Relay admission: the shared authentication leg (admission/auth.ts), then
 *  this edge's own gates — owner, operate-scope + key binding, terms. The
 *  token rides in the query string and must NEVER be logged (only the
 *  pathname, which carries no secret). */
export function createRelayAdmission(deps: RelayAdmissionDeps): RelayAdmission {
  return async (req, url, agentId, relayKind) => {
    const site: WsAuthSite = {
      edge: "ws",
      relay: relayKind,
      agentId,
      sourceIp: upgradeSourceIp(req),
    };

    const admitted = await deps.authenticate(
      url.searchParams.get("token"),
      site,
    );
    if (!admitted.ok) return admitted;
    const { user } = admitted.principal;

    if (!(await deps.verifyOwner(agentId, user.sub))) {
      securityLog("warn", "ws.owner_mismatch", {
        category: "authz",
        actor: user.sub,
        actorKind: "user",
        surface: "ws",
        agentId,
        decision: "deny",
        reason: "not-owner",
        sourceIp: site.sourceIp,
        detail: { relay: relayKind },
      });
      return { ok: false, kind: "not-owner" };
    }
    // ACP and terminal WebSocket attachment is `agents:operate` plus per-key
    // agent binding. Without these checks, an exfiltrated key bound to one
    // agent could speak ACP to any owned agent.
    if (!hasScope(user, "agents:operate") || !hasAgentBinding(user, agentId)) {
      return { ok: false, kind: "not-permitted" };
    }

    const termsDenied = await checkWsTermsAccepted(
      deps.isTermsAccepted,
      user.sub,
      site,
    );
    if (termsDenied) return { ok: false, kind: termsDenied };

    // Success: a human (or token-bearer) is attaching to a credentialed pod —
    // an interactive shell (terminal) or prompt channel (acp).
    logWsAttach(user.sub, site);
    return { ok: true, user };
  };
}

interface UpgradeTarget {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
}
interface RelayTarget {
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    agentId: string,
  ): void;
}

export type UpgradeRouteHandler = (
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  url: URL,
  /** URLPattern groups, verbatim — not URI-decoded. */
  params: Record<string, string | undefined>,
) => void | Promise<void>;

/** One upgrade listener over an explicit route table. Patterns are standard
 *  URLPattern pathname syntax (`:name` params, `*` wildcards), matched in
 *  insertion order; first match wins, no match destroys the socket. The
 *  dispatcher knows nothing about what a route needs from its path — the
 *  captured params go to the handler verbatim. A throwing handler closes
 *  the socket instead of crashing the process (upgrade listeners are not
 *  awaited by Node). */
export function createUpgradeHandler(
  routes: Record<string, UpgradeRouteHandler>,
) {
  const table = Object.entries(routes).map(([pathname, handler]) => ({
    pattern: new URLPattern({ pathname }),
    handler,
  }));

  return async (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    for (const { pattern, handler } of table) {
      const match = pattern.exec(url.href);
      if (!match) continue;
      try {
        await handler(req, socket, head, url, match.pathname.groups);
      } catch (err) {
        getLogger().error(
          { path: url.pathname, error: (err as Error).message },
          "upgrade.route.failed",
        );
        socket.destroy();
      }
      return;
    }
    socket.destroy();
  };
}

/** A surface that authenticates inside its own protocol — admitted with no
 *  check at the dispatch. */
export const selfAuthenticated =
  (target: UpgradeTarget): UpgradeRouteHandler =>
  (req, socket, head) => {
    target.handleUpgrade(req, socket, head);
  };

/** An agent relay behind the query-token admission. Owns the agent-relay
 *  assumptions the dispatcher must not know: the route pattern captures the
 *  agent as `:id`, and `relayKind` labels the surface in audit logs. */
export function relayRoute(
  admission: RelayAdmission,
  relay: RelayTarget,
  relayKind: string,
): UpgradeRouteHandler {
  return async (req, socket, head, url, params) => {
    if (params.id === undefined) {
      // Wiring bug: relayRoute mounted on a pattern without `:id`.
      throw new Error(`relayRoute(${relayKind}): pattern captured no :id`);
    }
    const agentId = decodeURIComponent(params.id);

    const admitted = await admission(req, url, agentId, relayKind);
    if (!admitted.ok) {
      socket.write(`HTTP/1.1 ${upgradeDenial[admitted.kind]}\r\n\r\n`);
      socket.destroy();
      return;
    }
    relay.handleUpgrade(req, socket, head, agentId);
  };
}
