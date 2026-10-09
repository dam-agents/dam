import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";

import { createAcpSessionClient } from "../modules/chat/infrastructure/acp-session-client.js";

describe("createAcpSessionClient", () => {
  let wss: WebSocketServer | undefined;

  afterEach(() => {
    wss?.close();
    wss = undefined;
  });

  // TEST_SCENARIO: `dam chat --resume` and `--continue` list Sessions over ACP before they open the terminal. When the server drops the ACP connection before it answers `initialize`, the list must fail at once. A request left pending forever let the event loop empty, and Node ended `dam chat` with "Detected unsettled top-level await" instead of an error.
  it.each([
    ["closes", (ws: WebSocket) => ws.close()],
    ["terminates", (ws: WebSocket) => ws.terminate()],
  ])("rejects when the server %s during initialize", async (_, drop) => {
    wss = new WebSocketServer({ port: 0 });
    wss.on("connection", (ws) => ws.on("message", () => drop(ws)));
    const { port } = wss.address() as { port: number };

    await expect(
      createAcpSessionClient({
        host: `http://127.0.0.1:${port}`,
        token: "t",
      }).list("agent"),
    ).rejects.toThrow("ACP connection closed");
  });
});
