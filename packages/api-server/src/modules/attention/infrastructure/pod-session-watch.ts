import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import {
  podSessionNoticeSchema,
  type AppRouter as AgentRuntimeRouter,
  type PodSession,
} from "agent-runtime-api";

import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: One connection to one pod, carrying both halves of
 * the pull design — the watch that says "re-read" and the read it triggers.
 * They share a socket because a notice is always followed by a read, and a
 * connection per read costs a handshake on every turn of every awake agent.
 */
export interface PodSessionSubscription {
  close(): void;
  listSessions(): Promise<PodSession[]>;
}

export interface PodSessionClient {
  watchAgent(agentId: string, onNotice: () => void): PodSessionSubscription;
  listSessions(agentId: string): Promise<PodSession[]>;
}

export function createPodSessionClient(
  namespace: string,
  log: (message: string) => void,
): PodSessionClient {
  const connect = (agentId: string) => {
    const wsClient = createWSClient({
      url: `ws://${podBaseUrl(agentId, namespace)}/api/trpc-ws`,
      keepAlive: { enabled: true },
      onError: () => log(`pod session watch errored for ${agentId}`),
    });
    const client = createTRPCClient<AgentRuntimeRouter>({
      links: [wsLink({ client: wsClient })],
    });
    return { wsClient, client };
  };

  return {
    watchAgent(agentId, onNotice) {
      const { wsClient, client } = connect(agentId);
      const subscription = client.sessions.watch.subscribe(undefined, {
        onData: (raw) => {
          if (!podSessionNoticeSchema.safeParse(raw).success) {
            log(`dropped unknown session notice from ${agentId}`);
            return;
          }
          onNotice();
        },
        onError: () => log(`pod session watch dropped for ${agentId}`),
      });

      return {
        listSessions: async () => (await client.sessions.list.query()).sessions,
        close() {
          subscription.unsubscribe();
          wsClient.close();
        },
      };
    },

    async listSessions(agentId) {
      const { wsClient, client } = connect(agentId);
      try {
        const { sessions } = await client.sessions.list.query();
        return sessions;
      } finally {
        wsClient.close();
      }
    },
  };
}
