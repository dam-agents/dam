import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { URLPattern } from "node:url";
import type { UserIdentity } from "api-server-api";
import { getLogger } from "../../../core/logger.js";
import { securityLog } from "../../../core/security-log.js";
import type { IsAcceptedPort } from "../../../modules/terms/index.js";
import {
  clientSurface,
  hasAgentBinding,
  hasScope,
  logWsAttach,
  upgradeSourceIp,
  type Authenticate,
  type AuthDenialKind,
  type SurfaceAttribution,
  type WsAuthSite,
} from "../admission/auth.js";
import { emit, EventType } from "../../../events.js";
import {
  checkWsTermsAccepted,
  type TermsDenialKind,
} from "../admission/terms.js";
import { upgradeDenial } from "./mappers.js";

export type RelayDenialKind = "not-owner" | "not-permitted";

export type RelayAdmissionDenialKind =
  | AuthDenialKind
  | TermsDenialKind
  | RelayDenialKind;

export type RelayAdmissionResult =
  | { ok: true; user: UserIdentity; surface: string }
  | { ok: false; kind: RelayAdmissionDenialKind };

export interface RelayAdmissionDeps {
  authenticate: Authenticate;
  verifyOwner: (agentId: string, ownerSub: string) => Promise<boolean>;
  isTermsAccepted: IsAcceptedPort;
  surfaceAttribution: SurfaceAttribution;
}

export type RelayAdmission = (
  req: IncomingMessage,
  url: URL,
  agentId: string,
  relayKind: string,
) => Promise<RelayAdmissionResult>;

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
    if (!hasScope(user, "agents:operate") || !hasAgentBinding(user, agentId)) {
      return { ok: false, kind: "not-permitted" };
    }

    const termsDenied = await checkWsTermsAccepted(
      deps.isTermsAccepted,
      user.sub,
      site,
    );
    if (termsDenied) return { ok: false, kind: termsDenied };

    const surface = clientSurface(admitted.principal, deps.surfaceAttribution);
    logWsAttach(user.sub, site);
    emit({
      type: EventType.AgentRelayAttached,
      agentId,
      actorSub: user.sub,
      surface,
      relay: relayKind,
    });
    return { ok: true, user, surface };
  };
}

interface UpgradeTarget {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
}
export interface RelayActor {
  sub: string;
  surface: string;
}

interface RelayTarget {
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    agentId: string,
    actor: RelayActor,
  ): void;
}

export type UpgradeRouteHandler = (
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  url: URL,
  params: Record<string, string | undefined>,
) => void | Promise<void>;

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

export const selfAuthenticated =
  (target: UpgradeTarget): UpgradeRouteHandler =>
  (req, socket, head) => {
    target.handleUpgrade(req, socket, head);
  };

export function relayRoute(
  admission: RelayAdmission,
  relay: RelayTarget,
  relayKind: string,
): UpgradeRouteHandler {
  return async (req, socket, head, url, params) => {
    if (params.id === undefined) {
      throw new Error(`relayRoute(${relayKind}): pattern captured no :id`);
    }
    const agentId = decodeURIComponent(params.id);

    const admitted = await admission(req, url, agentId, relayKind);
    if (!admitted.ok) {
      socket.write(`HTTP/1.1 ${upgradeDenial[admitted.kind]}\r\n\r\n`);
      socket.destroy();
      return;
    }
    relay.handleUpgrade(req, socket, head, agentId, {
      sub: admitted.user.sub,
      surface: admitted.surface,
    });
  };
}
