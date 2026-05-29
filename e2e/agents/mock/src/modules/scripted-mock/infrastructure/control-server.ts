import http from "node:http";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { appRouter, type MockAgentContext } from "mock-agent-api";
import type { ScriptedMockService } from "mock-agent-api";

export interface ControlServer {
  listen(port: number, host: string): Promise<void>;
  close(): Promise<void>;
}

export function createControlServer(
  scriptedMock: ScriptedMockService,
): ControlServer {
  const handler = createHTTPHandler({
    router: appRouter,
    createContext: (): MockAgentContext => ({ scriptedMock }),
  });

  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/api/trpc")) {
      req.url = req.url.replace("/api/trpc", "");
      handler(req, res);
      return;
    }
    res.writeHead(404).end();
  });

  return {
    listen(port, host) {
      return new Promise((resolve) =>
        server.listen(port, host, () => resolve()),
      );
    },
    close() {
      return new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}
