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
import { trpcDenial } from "./mappers.js";

const API_KEY_REAUTH_MS = 5 * 60_000;
const RECONNECT_NUDGE_BEFORE_MS = 30_000;

const CLOSE_CREDENTIAL_EXPIRED = 4401;

export interface TrpcWsDeps {
  authenticate: Authenticate;
  surfaceAttribution: SurfaceAttribution;
  composeApiContext: (user: UserIdentity, surface: string) => ApiContext;
}

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
