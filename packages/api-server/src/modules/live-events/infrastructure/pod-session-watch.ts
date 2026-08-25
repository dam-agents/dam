import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import type { AppRouter as AgentRuntimeRouter } from "agent-runtime-api";

import { podBaseUrl } from "../../agents/infrastructure/k8s.js";
import type { PodSessionWatch } from "../services/pod-sessions-service.js";

export function createPodSessionWatcher(
  namespace: string,
  log: (message: string) => void,
) {
  return function watchAgent(
    agentId: string,
    onNotice: () => void,
  ): PodSessionWatch {
    const wsClient = createWSClient({
      url: `ws://${podBaseUrl(agentId, namespace)}/api/trpc-ws`,
      keepAlive: { enabled: true },
      onError: () => log(`pod session watch errored for ${agentId}`),
    });
    const client = createTRPCClient<AgentRuntimeRouter>({
      links: [wsLink({ client: wsClient })],
    });
    const subscription = client.sessions.watch.subscribe(undefined, {
      onData: () => onNotice(),
      onError: () => log(`pod session watch dropped for ${agentId}`),
    });

    return {
      close() {
        subscription.unsubscribe();
        wsClient.close();
      },
    };
  };
}
