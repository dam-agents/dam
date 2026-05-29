import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import type { E2eService } from "api-server-api";
import type { AppRouter as MockAppRouter } from "mock-agent-api";
import WS from "ws";
import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

export function createE2eService(deps: { namespace: string }): E2eService {
  async function withClient<T>(
    agentId: string,
    fn: (
      client: ReturnType<typeof createTRPCClient<MockAppRouter>>,
    ) => Promise<T>,
  ): Promise<T> {
    const url = `ws://${podBaseUrl(agentId, deps.namespace)}/api/acp`;
    const wsClient = createWSClient({
      url,
      WebSocket: WS as unknown as typeof WebSocket,
      lazy: { enabled: false, closeMs: 0 },
    });
    const client = createTRPCClient<MockAppRouter>({
      links: [wsLink({ client: wsClient })],
    });
    try {
      return await fn(client);
    } finally {
      wsClient.close();
    }
  }

  return {
    setScript: (agentId, input) =>
      withClient(agentId, (c) => c.scriptedMock.setScript.mutate(input)),
    getReceivedPrompts: (agentId) =>
      withClient(agentId, (c) => c.scriptedMock.getReceivedPrompts.query()),
    reset: (agentId) =>
      withClient(agentId, (c) => c.scriptedMock.reset.mutate()),
  };
}
