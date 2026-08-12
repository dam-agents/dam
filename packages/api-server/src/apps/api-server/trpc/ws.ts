import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { TRPCError } from "@trpc/server";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import type { ApiContext, UserIdentity } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { WebSocketServer, type WebSocket } from "ws";
import type { IsAcceptedPort } from "../../../modules/terms/index.js";
import {
  emitUserAuthenticated,
  logWsAttach,
  upgradeSourceIp,
  type Authenticate,
  type SurfaceAttribution,
} from "../admission/auth.js";
import { checkWsTermsAccepted } from "../admission/terms.js";
import { trpcDenial } from "./mappers.js";

/** API-key principals surface no `expiresAt` (key expiry and revocation are
 *  enforced per verify call), so their connections re-authenticate on a
 *  fixed cadence. This interval is the platform's revocation latency for
 *  socket-held keys — keep it at or below the Keycloak access-token
 *  lifetime so keys are never revocable more slowly than JWT sessions.
 *  Push revocation (closing sockets the moment a key is revoked) is
 *  deferred to the Redis-backed event bus. */
const API_KEY_REAUTH_MS = 5 * 60_000;
/** Sent this long before the deadline so the client reconnects with a fresh
 *  token while the old connection is still alive. */
const RECONNECT_NUDGE_BEFORE_MS = 30_000;

// Application close code (RFC 6455 4000–4999). wsLink reconnects on it; it
// exists so logs and devtools can tell rotation from network death.
const CLOSE_CREDENTIAL_EXPIRED = 4401;

export interface TrpcWsDeps {
  authenticate: Authenticate;
  /** For the per-connection UserAuthenticated emission (usage analytics). */
  surfaceAttribution: SurfaceAttribution;
  isTermsAccepted: IsAcceptedPort;
  composeApiContext: (user: UserIdentity) => ApiContext;
}

/** The tRPC-over-WebSocket endpoint (`/api/trpc-ws`): same router as
 *  `/api/trpc`, different transport. Auth rides the first frame
 *  (connectionParams), never the URL, and a connection never outlives its
 *  credential — nudged reconnect before the deadline, hard close at it. */
export function createTrpcWsEndpoint(deps: TrpcWsDeps) {
  const wss = new WebSocketServer({ noServer: true });

  function attachCredentialLifecycle(
    ws: WebSocket,
    expiresAt: Date | undefined,
  ): void {
    const closeInMs = Math.max(
      (expiresAt?.getTime() ?? Date.now() + API_KEY_REAUTH_MS) - Date.now(),
      0,
    );
    const nudgeInMs = Math.max(closeInMs - RECONNECT_NUDGE_BEFORE_MS, 0);
    const timers = [
      setTimeout(() => {
        // The protocol's reconnect notification — the same frame
        // broadcastReconnectNotification sends, scoped to one client.
        // tRPC routes incoming frames on `method`, so a `type`-keyed frame
        // is silently dropped by wsLink (TRPCReconnectNotification is
        // `{ id, method: "reconnect" }`).
        ws.send(JSON.stringify({ id: null, method: "reconnect" }));
      }, nudgeInMs),
      setTimeout(() => {
        ws.close(CLOSE_CREDENTIAL_EXPIRED, "credential expired");
      }, closeInMs),
    ];

    ws.once("close", () => {
      for (const t of timers) clearTimeout(t);
    });
  }

  const handler = applyWSSHandler({
    wss,
    router: appRouter,
    keepAlive: { enabled: true, pingMs: 30_000, pongWaitMs: 10_000 },
    createContext: async ({ req, res, info }): Promise<ApiContext> => {
      const site = {
        edge: "ws" as const,
        relay: "trpc",
        sourceIp: upgradeSourceIp(req),
      };

      const admitted = await deps.authenticate(
        info.connectionParams?.token,
        site,
      );
      if (!admitted.ok) {
        throw new TRPCError(trpcDenial[admitted.kind]);
      }
      const { user } = admitted.principal;

      const termsDenied = await checkWsTermsAccepted(
        deps.isTermsAccepted,
        user.sub,
        site,
      );
      if (termsDenied) {
        throw new TRPCError(trpcDenial[termsDenied]);
      }

      // Once per connection, not per request — the socket is this
      // principal's authenticated session for usage analytics.
      emitUserAuthenticated(admitted.principal, deps.surfaceAttribution);
      logWsAttach(user.sub, site);
      attachCredentialLifecycle(res, admitted.principal.expiresAt);
      return deps.composeApiContext(user);
    },
  });

  return {
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    },
    /** Pre-shutdown: ask every client to reconnect now, so they land on
     *  surviving replicas before this one closes its sockets. */
    drain(): void {
      handler.broadcastReconnectNotification();
    },
    async close(): Promise<void> {
      for (const ws of wss.clients) ws.close(1001, "server shutting down");
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    },
  };
}
