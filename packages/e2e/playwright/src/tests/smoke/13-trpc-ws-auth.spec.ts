import { expect, test } from "@playwright/test";

import { createApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { baseUrl } from "../../config.js";

const WS_URL = `${baseUrl.replace(/^http/, "ws")}/api/trpc-ws`;

interface WireFrame {
  id: number | null;
  result?: { type: string; data?: unknown };
  error?: { data?: { code?: string } };
}

function queryOverWs(token: string | null): Promise<WireFrame> {
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
    expect(frame.error?.data?.code).not.toBe("UNAUTHORIZED");
    expect(frame.error?.data?.code).not.toBe("FORBIDDEN");
    expect(frame.result?.type).toBe("data");
    expect(Array.isArray(frame.result?.data)).toBe(true);
  });
});
