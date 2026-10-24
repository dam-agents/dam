import { sessionNoticeSchema, type Session } from "agent-runtime-api";

import { agentServiceWsClient } from "../../../core/agent-service-client.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: One connection to one agent's runtime, carrying
 * both halves of the pull design — the watch that says "re-read" and the read
 * it triggers. They share a socket because a notice is always followed by a
 * read, and a connection per read costs a handshake on every turn of every
 * awake agent.
 */
export interface WatchedSessionList {
  sessions: Session[];
  incomplete: boolean;
}

export interface SessionSubscription {
  close(): void;
  listSessions(): Promise<WatchedSessionList>;
}

export interface SessionWatchClient {
  watchAgent(agentId: string, onNotice: () => void): SessionSubscription;
  listSessions(
    agentId: string,
    signal: AbortSignal,
  ): Promise<WatchedSessionList>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A read waits for its socket to open, and the
 * socket retries for as long as the runtime cannot be reached. An Agent
 * deleted before its runtime ever answered is never reached, so without a bound
 * the read and its retries outlive the Agent until the process restarts. A live
 * watch's read is bounded too: a runtime that stops answering must not leave a
 * capture waiting until the watch is released.
 */
const READ_TIMEOUT_MS = 10_000;

export function createSessionWatchClient(
  namespace: string,
  log: (message: string) => void,
  webSocket?: typeof WebSocket,
): SessionWatchClient {
  const connect = (agentId: string) =>
    agentServiceWsClient(agentId, namespace, {
      webSocket,
      onError: () => log(`session watch errored for ${agentId}`),
    });

  return {
    watchAgent(agentId, onNotice) {
      const { wsClient, client } = connect(agentId);
      const subscription = client.sessions.watch.subscribe(undefined, {
        onData: (raw) => {
          if (!sessionNoticeSchema.safeParse(raw).success) {
            log(`dropped unknown session notice from ${agentId}`);
            return;
          }
          onNotice();
        },
        onError: () => log(`session watch dropped for ${agentId}`),
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
