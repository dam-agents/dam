import type { PodSession, RuntimeFeatures } from "agent-runtime-api";

import { emit, EventType } from "../../../events.js";
import type { InfraAgent } from "../../agents/infrastructure/agent-mappers.js";
import { agentStreamable } from "../../agents/index.js";
import { sameRecord, type AttentionRecordRow } from "../domain/types.js";
import type { AttentionRepository } from "../infrastructure/attention-repository.js";
import type { PodSessionClient } from "../infrastructure/pod-session-watch.js";

const RECONCILE_BACKSTOP_MS = 60_000;
const CAPTURE_DEBOUNCE_MS = 250;
const COMPAT_POLL_MS = 15_000;

export interface SessionWatcher {
  start(): void;
  stop(): void;
  agentsChanged(): void;
}

interface Held {
  ownerSub: string;
  close(): void;
  read(): Promise<PodSession[]>;
  poll: ReturnType<typeof setInterval> | null;
  debounce: ReturnType<typeof setTimeout> | null;
  /**
   * UNIT_BOUNDARY_DESCRIPTION: What this agent's rows looked like at the last
   * capture, so an unchanged notice costs nothing but the pod read. Most
   * notices change one session or none — reading every stored row back to find
   * that out would put the database on the hot path. Empty until the first
   * capture after a hold, which is what makes a new lease holder re-read once.
   */
  known: Map<string, AttentionRecordRow> | null;
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toRow(
  agentId: string,
  ownerSub: string,
  session: PodSession,
): AttentionRecordRow {
  return {
    agentId,
    sessionId: session.sessionId,
    ownerSub,
    mode: session.mode,
    type: session.type,
    title: session.title,
    scheduleId: session.scheduleId,
    experimentId: session.experimentId,
    createdAt: toDate(session.createdAt) ?? new Date(),
    activityAt: toDate(session.updatedAt),
    seenAt: toDate(session.seenAt),
    working: session.running,
  };
}

export function createSessionWatcher(deps: {
  listAgents: () => Promise<InfraAgent[]>;
  runtimeFeaturesFor: (
    agentIds: string[],
  ) => Promise<Map<string, RuntimeFeatures>>;
  pods: PodSessionClient;
  repo: AttentionRepository;
  log: (message: string) => void;
}): SessionWatcher {
  const held = new Map<string, Held>();
  let backstop: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let reconciling = false;
  let again = false;

  async function capture(agentId: string): Promise<void> {
    const entry = held.get(agentId);
    if (!entry) return;
    let sessions: PodSession[];
    try {
      sessions = await entry.read();
    } catch (error) {
      deps.log(`capture failed for ${agentId}: ${(error as Error).message}`);
      return;
    }
    if (held.get(agentId) !== entry) return;

    entry.known ??= new Map(
      (await deps.repo.listForAgent(agentId)).map((row) => [
        row.sessionId,
        row,
      ]),
    );
    if (held.get(agentId) !== entry) return;

    let wrote = false;
    for (const session of sessions) {
      const next = toRow(agentId, entry.ownerSub, session);
      const current = entry.known.get(next.sessionId);
      if (current && sameRecord(current, next)) continue;
      await deps.repo.upsertRecord(next);
      entry.known.set(next.sessionId, next);
      wrote = true;
    }

    const listed = new Set(sessions.map((session) => session.sessionId));
    const gone = [...entry.known.keys()].filter(
      (sessionId) => !listed.has(sessionId),
    );
    if (gone.length > 0) {
      await deps.repo.deleteSessions(agentId, gone);
      for (const sessionId of gone) entry.known.delete(sessionId);
      wrote = true;
    }

    if (!wrote) return;
    emit({
      type: EventType.AttentionChanged,
      ownerSub: entry.ownerSub,
      agentId,
    });
  }

  function scheduleCapture(agentId: string): void {
    const entry = held.get(agentId);
    if (!entry || entry.debounce) return;
    entry.debounce = setTimeout(() => {
      entry.debounce = null;
      void capture(agentId);
    }, CAPTURE_DEBOUNCE_MS);
    entry.debounce.unref?.();
  }

  function release(agentId: string): void {
    const entry = held.get(agentId);
    if (!entry) return;
    entry.close();
    if (entry.poll) clearInterval(entry.poll);
    if (entry.debounce) clearTimeout(entry.debounce);
    held.delete(agentId);
  }

  function hold(agent: InfraAgent, live: boolean): void {
    const ownerSub = agent.owner;
    if (!ownerSub) return;
    const entry: Held = {
      ownerSub,
      close: () => {},
      read: () => deps.pods.listSessions(agent.id),
      poll: null,
      debounce: null,
      known: null,
    };
    held.set(agent.id, entry);
    if (live) {
      const subscription = deps.pods.watchAgent(agent.id, () =>
        scheduleCapture(agent.id),
      );
      entry.close = () => subscription.close();
      entry.read = () => subscription.listSessions();
    } else {
      deps.log(`${agent.id} has no live updates, polling its sessions`);
      entry.poll = setInterval(() => void capture(agent.id), COMPAT_POLL_MS);
      entry.poll.unref?.();
    }
    void capture(agent.id);
  }

  async function reconcile(): Promise<void> {
    if (!running) return;
    if (reconciling) {
      again = true;
      return;
    }
    reconciling = true;
    try {
      const agents = (await deps.listAgents()).filter(agentStreamable);
      if (!running) return;
      const wanted = new Map(agents.map((agent) => [agent.id, agent]));

      for (const agentId of [...held.keys()]) {
        if (!wanted.has(agentId)) release(agentId);
      }
      const fresh = agents.filter((agent) => !held.has(agent.id));
      if (fresh.length === 0) return;

      const features = await deps.runtimeFeaturesFor(fresh.map((a) => a.id));
      if (!running) return;
      for (const agent of fresh) {
        if (held.has(agent.id)) continue;
        hold(agent, features.get(agent.id)?.liveUpdates === true);
      }
    } catch (error) {
      deps.log(`reconcile failed: ${(error as Error).message}`);
    } finally {
      reconciling = false;
      if (again && running) {
        again = false;
        void reconcile();
      }
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      void reconcile();
      backstop = setInterval(() => void reconcile(), RECONCILE_BACKSTOP_MS);
      backstop.unref?.();
    },
    stop() {
      running = false;
      if (backstop) clearInterval(backstop);
      backstop = null;
      again = false;
      for (const agentId of [...held.keys()]) release(agentId);
    },
    agentsChanged() {
      if (running) void reconcile();
    },
  };
}
