import {
  createTRPCClient,
  createWSClient,
  httpBatchLink,
  wsLink,
} from "@trpc/client";
import type { AppRouter } from "agent-runtime-api";

import { getAccessToken } from "../../auth.js";
import { useStore } from "../../store.js";

const IDLE_CLOSE_MS = 30_000;

export type AgentTrpcClient = ReturnType<typeof createTRPCClient<AppRouter>>;

function isAbnormalClose(code: number | undefined): boolean {
  return code !== undefined && code !== 1000 && code !== 1005;
}

async function agentTrpcUrl(agentId: string): Promise<string> {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const token = await getAccessToken();
  return (
    `${proto}://${location.host}/api/agents/${encodeURIComponent(agentId)}` +
    `/trpc-ws?token=${encodeURIComponent(token)}`
  );
}

function createAgentTrpc(agentId: string): AgentTrpcClient {
  const wsClient = createWSClient({
    url: () => agentTrpcUrl(agentId),
    lazy: { enabled: true, closeMs: IDLE_CLOSE_MS },
    keepAlive: { enabled: true },
    onOpen: () => useStore.getState().clearAgentUnreachable(agentId),
    onError: () => useStore.getState().markAgentUnreachable(agentId),
    onClose: (cause) => {
      if (isAbnormalClose(cause?.code))
        useStore.getState().markAgentUnreachable(agentId);
    },
  });
  return createTRPCClient<AppRouter>({ links: [wsLink({ client: wsClient })] });
}

const clients = new Map<string, AgentTrpcClient>();
const httpClients = new Map<string, AgentTrpcClient>();

export function agentTrpcHttp(agentId: string): AgentTrpcClient {
  let client = httpClients.get(agentId);
  if (!client) {
    client = createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: `/api/agents/${encodeURIComponent(agentId)}/trpc`,
          headers: async () => ({
            Authorization: `Bearer ${await getAccessToken()}`,
          }),
        }),
      ],
    });
    httpClients.set(agentId, client);
  }
  return client;
}

export function agentTrpc(agentId: string): AgentTrpcClient {
  let client = clients.get(agentId);
  if (!client) {
    client = createAgentTrpc(agentId);
    clients.set(agentId, client);
  }
  return client;
}
