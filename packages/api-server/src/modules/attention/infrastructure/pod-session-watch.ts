import { podSessionNoticeSchema, type PodSession } from "agent-runtime-api";

import { agentPodWsClient } from "../../../core/agent-pod-client.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: One connection to one pod, carrying both halves of
 * the pull design — the watch that says "re-read" and the read it triggers.
 * They share a socket because a notice is always followed by a read, and a
 * connection per read costs a handshake on every turn of every awake agent.
 */
export interface PodSessionList {
  sessions: PodSession[];
  incomplete: boolean;
}

export interface PodSessionSubscription {
  close(): void;
  listSessions(): Promise<PodSessionList>;
}

export interface PodSessionClient {
  watchAgent(agentId: string, onNotice: () => void): PodSessionSubscription;
  listSessions(agentId: string, signal: AbortSignal): Promise<PodSessionList>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A read waits for its socket to open, and the
 * socket retries for as long as the pod cannot be reached. An Agent deleted
 * before its pod ever answered is never reached, so without a bound the read
 * and its retries outlive the Agent until the process restarts. A live watch's
 * read is bounded too: a pod that stops answering must not leave a capture
 * waiting until the watch is released.
 */
const READ_TIMEOUT_MS = 10_000;

export function createPodSessionClient(
  namespace: string,
  log: (message: string) => void,
  webSocket?: typeof WebSocket,
): PodSessionClient {
  const connect = (agentId: string) =>
    agentPodWsClient(agentId, namespace, {
      webSocket,
      onError: () => log(`pod session watch errored for ${agentId}`),
    });

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
        listSessions: async () => {
          const page = await client.sessions.list.query(undefined, {
            signal: AbortSignal.timeout(READ_TIMEOUT_MS),
          });
          return { sessions: page.sessions, incomplete: !!page.incomplete };
        },
        close() {
          subscription.unsubscribe();
          wsClient.close();
        },
      };
    },

    async listSessions(agentId, signal) {
      const { wsClient, client } = connect(agentId);
      try {
        const page = await client.sessions.list.query(undefined, {
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(READ_TIMEOUT_MS),
          ]),
        });
        return { sessions: page.sessions, incomplete: !!page.incomplete };
      } finally {
        wsClient.close();
      }
    },
  };
}
