import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { TRPCError } from "@trpc/server";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import type { ApiContext, UserIdentity } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { WebSocketServer, type WebSocket } from "ws";
import {
  clientSurface,
  emitUserAuthenticated,
  logWsAttach,
  upgradeSourceIp,
  type Authenticate,
  type SurfaceAttribution,
} from "../admission/auth.js";
import { addUpgradeSecurityHeaders } from "../agent-proxies/upgrade.js";
import { logInternalError } from "./log-internal-error.js";
import { trpcDenial } from "./mappers.js";

const API_KEY_REAUTH_MS = 5 * 60_000;
const RECONNECT_NUDGE_BEFORE_MS = 30_000;

const CLOSE_CREDENTIAL_EXPIRED = 4401;
const DENIAL_HOLD_MS = 1_000;

export interface TrpcWsDeps {
  authenticate: Authenticate;
  surfaceAttribution: SurfaceAttribution;
  composeApiContext: (user: UserIdentity, surface: string) => ApiContext;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A refused context makes tRPC's adapter answer
 * under a null id, which the client cannot match to a request, and close the
 * socket on the next tick, so a request that arrives later sees only a bare
 * close. Holding the refusal until the connection's first request has
 * reached the adapter lets that request carry the denial code under its own
 * id; a client that sends nothing is still closed once the hold runs out.
 */
function firstRequestOrTimeout(ws: WebSocket, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    ws.once("message", () => {
      clearTimeout(timer);
      setImmediate(resolve);
    });
  });
}

export function createTrpcWsEndpoint(deps: TrpcWsDeps) {
  const wss = new WebSocketServer({ noServer: true });
  addUpgradeSecurityHeaders(wss);

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
    onError: logInternalError,
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
        await firstRequestOrTimeout(res, DENIAL_HOLD_MS);
        throw new TRPCError(trpcDenial[admitted.kind]);
      }
      const { user } = admitted.principal;

      emitUserAuthenticated(admitted.principal, deps.surfaceAttribution);
      logWsAttach(user.sub, site);
      attachCredentialLifecycle(res, admitted.principal.expiresAt);
      return deps.composeApiContext(
        user,
        clientSurface(admitted.principal, deps.surfaceAttribution),
      );
    },
  });

  return {
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    },
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
