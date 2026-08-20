import { randomUUID } from "node:crypto";
import type {
  HostedSessionRow,
  TurnLogRepository,
} from "../infrastructure/turn-log-repository.js";
import type { TurnEvent } from "../domain/events.js";
import type { TurnsQueue } from "../infrastructure/turns-queue.js";

export interface HostedSessionsService {
  createSession(input: {
    agentId: string;
    title?: string;
    scheduleId?: string;
  }): Promise<HostedSessionRow>;
  listSessions(agentId: string): Promise<HostedSessionRow[]>;
  getSession(sessionId: string): Promise<HostedSessionRow | null>;
  deleteSession(sessionId: string): Promise<void>;
  prompt(input: {
    sessionId: string;
    text: string;
    source?: "user" | "schedule" | "channel";
  }): Promise<{ turnId: string } | { refused: "turn-in-flight" }>;
  interrupt(sessionId: string): Promise<boolean>;
  listEvents(sessionId: string, afterId?: number): Promise<TurnEvent[]>;
  turnInFlight(sessionId: string): Promise<boolean>;
  recordSeen(sessionId: string): Promise<void>;
  setMode(sessionId: string, mode: string): Promise<void>;
}

export interface HostedSessionsDeps {
  repo: TurnLogRepository;
  queue: TurnsQueue;
  owner: string;
  isOwnedHostedAgent(agentId: string): Promise<boolean>;
}

export function createHostedSessionsService(
  deps: HostedSessionsDeps,
): HostedSessionsService {
  async function ownedSession(
    sessionId: string,
  ): Promise<HostedSessionRow | null> {
    const session = await deps.repo.getSession(sessionId);
    return session && session.owner === deps.owner ? session : null;
  }

  return {
    async createSession(input) {
      if (!(await deps.isOwnedHostedAgent(input.agentId))) {
        throw new Error(`agent ${input.agentId}: not found or not hosted`);
      }
      const id = `hs-${randomUUID()}`;
      await deps.repo.createSession({
        id,
        agentId: input.agentId,
        owner: deps.owner,
        title: input.title,
        scheduleId: input.scheduleId,
      });
      const session = await deps.repo.getSession(id);
      if (!session) throw new Error("session create failed");
      return session;
    },

    async listSessions(agentId) {
      if (!(await deps.isOwnedHostedAgent(agentId))) return [];
      return deps.repo.listSessions(agentId);
    },

    getSession: ownedSession,

    async deleteSession(sessionId) {
      const session = await ownedSession(sessionId);
      if (session) await deps.repo.deleteSession(sessionId);
    },

    async prompt(input) {
      const session = await ownedSession(input.sessionId);
      if (!session) throw new Error("session not found");
      if (await deps.repo.runningTurnForSession(session.id)) {
        return { refused: "turn-in-flight" };
      }
      const turnId = `ht-${randomUUID()}`;
      await deps.repo.createTurn({
        id: turnId,
        sessionId: session.id,
        agentId: session.agentId,
      });
      await deps.repo.appendEvent({
        sessionId: session.id,
        turnId,
        seq: 0,
        kind: "user-message",
        payload: { text: input.text, source: input.source ?? "user" },
      });
      await deps.queue.enqueue(turnId);
      return { turnId };
    },

    async interrupt(sessionId) {
      const session = await ownedSession(sessionId);
      if (!session) return false;
      const running = await deps.repo.runningTurnForSession(sessionId);
      if (!running) return false;
      await deps.repo.endTurn(running.id, "interrupted");
      return true;
    },

    async listEvents(sessionId, afterId) {
      const session = await ownedSession(sessionId);
      if (!session) return [];
      return deps.repo.listSessionEvents(sessionId, { afterId });
    },

    async turnInFlight(sessionId) {
      return (await deps.repo.runningTurnForSession(sessionId)) != null;
    },

    async recordSeen(sessionId) {
      const session = await ownedSession(sessionId);
      if (session) await deps.repo.recordSeen(sessionId, new Date());
    },

    async setMode(sessionId, mode) {
      const session = await ownedSession(sessionId);
      if (session) await deps.repo.setSessionMode(sessionId, mode);
    },
  };
}
