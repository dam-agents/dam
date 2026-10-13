import { expect, test } from "@playwright/test";

import { baseUrl } from "../../config.js";

const WS_URL = `${baseUrl.replace(/^http/, "ws")}/api/trpc-ws`;

interface WireFrame {
  id: number | null;
  result?: { type: string; data?: unknown };
  error?: { data?: { code?: string } };
}

function queryOverWs(): Promise<WireFrame> {
  const ws = new WebSocket(WS_URL);
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
    const frame = await queryOverWs();
    expect(frame.error?.data?.code).toBe("UNAUTHORIZED");
    expect(frame.result).toBeUndefined();
  });
});
