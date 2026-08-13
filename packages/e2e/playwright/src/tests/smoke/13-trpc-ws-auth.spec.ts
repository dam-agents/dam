import { expect, test } from "@playwright/test";

import { createApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { baseUrl } from "../../config.js";

/**
 * Connection auth for the tRPC-over-WebSocket endpoint, against the real
 * api-server + Keycloak (no browser). Opens a raw WebSocket to
 * `/api/trpc-ws` and drives the tRPC wire protocol directly, because the
 * property under test is admission itself: a connection may not run a
 * procedure unless its first frame carries a token that verifies and the
 * user has accepted terms.
 */

const WS_URL = `${baseUrl.replace(/^http/, "ws")}/api/trpc-ws`;

interface WireFrame {
  id: number | null;
  result?: { type: string; data?: unknown };
  error?: { data?: { code?: string } };
}

/**
 * Open a connection, optionally complete the connectionParams handshake with
 * `token`, fire one `agents.list` query, and resolve with the first frame that
 * answers it (`id: 1`) or rejects the connection (`id: null`). `token: null`
 * skips the handshake entirely — the unauthenticated case.
 */
function queryOverWs(token: string | null): Promise<WireFrame> {
  // `?connectionParams=1` tells the server to defer context creation until the
  // first frame supplies the token; without it the server authenticates
  // immediately against a null token.
  const url = token === null ? WS_URL : `${WS_URL}?connectionParams=1`;
  const ws = new WebSocket(url);
  return new Promise<WireFrame>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("no answer to query within 10s")),
      10_000,
    );
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("socket error"));
    });
    ws.addEventListener("open", () => {
      if (token !== null) {
        ws.send(
          JSON.stringify({ method: "connectionParams", data: { token } }),
        );
      }
      ws.send(
        JSON.stringify({
          id: 1,
          method: "query",
          params: { path: "agents.list", input: null },
        }),
      );
    });
    ws.addEventListener("message", (ev) => {
      const frame = JSON.parse(String(ev.data)) as WireFrame;
      if (frame.id === 1 || frame.id === null) {
        clearTimeout(timer);
        ws.close();
        resolve(frame);
      }
    });
  });
}

test.describe("tRPC-WS connection auth", () => {
  test("rejects a connection that supplies no token", async () => {
    const frame = await queryOverWs(null);
    expect(frame.error?.data?.code).toBe("UNAUTHORIZED");
    expect(frame.result).toBeUndefined();
  });

  test("rejects a connection whose token does not verify", async () => {
    const frame = await queryOverWs("pk_not.a.real.token");
    expect(frame.error?.data?.code).toBe("UNAUTHORIZED");
    expect(frame.result).toBeUndefined();
  });

  test("admits a real Keycloak token and runs the procedure", async () => {
    const token = await getAccessToken();
    await acceptTerms(createApiClient(token));

    const frame = await queryOverWs(token);
    // The query got past admission: a real result, no auth denial.
    expect(frame.error?.data?.code).not.toBe("UNAUTHORIZED");
    expect(frame.error?.data?.code).not.toBe("FORBIDDEN");
    expect(frame.result?.type).toBe("data");
    expect(Array.isArray(frame.result?.data)).toBe(true);
  });
});
