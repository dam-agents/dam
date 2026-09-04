import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";
import type { AgentView } from "../../types.js";
import { routeToPath } from "../platform/lib/routes.js";

export interface RestartingEntry {
  seenNonRunning: boolean;
  clickedAt: number;
  parkedAtClick?: boolean;
}

export interface AgentsSlice {
  selectedAgent: string | null;
  restartingAgents: Map<string, RestartingEntry>;
  setRestartingAgent: (id: string, entry: RestartingEntry) => void;
  clearRestartingAgent: (id: string) => void;
  setRestartingAgents: (map: Map<string, RestartingEntry>) => void;
  pausingAgents: Map<string, { clickedAt: number }>;
  setPausingAgent: (id: string, entry: { clickedAt: number }) => void;
  clearPausingAgent: (id: string) => void;
  setPausingAgents: (map: Map<string, { clickedAt: number }>) => void;
  unreachableAgents: ReadonlySet<string>;
  markAgentUnreachable: (id: string) => void;
  clearAgentUnreachable: (id: string) => void;
  deletedAgents: ReadonlySet<string>;
  markAgentDeleted: (id: string) => void;
  selectAgent: (id: string) => void;
  openKnowledgeBase: (id: string) => void;
  openAgentSession: (agentId: string, sessionId: string) => void;
  goBack: () => void;
}

export const createAgentsSlice: StateCreator<
  PlatformStore,
  [],
  [],
  AgentsSlice
> = (set, get) => ({
  selectedAgent: null,
  restartingAgents: new Map(),

  setRestartingAgent: (id, entry) =>
    set((s) => {
      const next = new Map(s.restartingAgents);
      next.set(id, entry);
      return { restartingAgents: next };
    }),
  clearRestartingAgent: (id) =>
    set((s) => {
      const next = new Map(s.restartingAgents);
      next.delete(id);
      return { restartingAgents: next };
    }),
  setRestartingAgents: (map) => set({ restartingAgents: map }),

  pausingAgents: new Map(),
  setPausingAgent: (id, entry) =>
    set((s) => {
      const next = new Map(s.pausingAgents);
      next.set(id, entry);
      return { pausingAgents: next };
    }),
  clearPausingAgent: (id) =>
    set((s) => {
      const next = new Map(s.pausingAgents);
      next.delete(id);
      return { pausingAgents: next };
    }),
  setPausingAgents: (map) => set({ pausingAgents: map }),

  unreachableAgents: new Set(),
  markAgentUnreachable: (id) =>
    set((s) => {
      if (s.unreachableAgents.has(id)) return {};
      const next = new Set(s.unreachableAgents);
      next.add(id);
      return { unreachableAgents: next };
    }),
  clearAgentUnreachable: (id) =>
    set((s) => {
      if (!s.unreachableAgents.has(id)) return {};
      const next = new Set(s.unreachableAgents);
      next.delete(id);
      return { unreachableAgents: next };
    }),

  deletedAgents: new Set(),
  markAgentDeleted: (id) =>
    set((s) => {
      if (s.deletedAgents.has(id)) return {};
      const next = new Set(s.deletedAgents);
      next.add(id);
      return { deletedAgents: next };
    }),

  selectAgent: (id) => {
    history.pushState(null, "", routeToPath({ view: "chat", agent: id }));
    get().resetChatContext();
    set({
      selectedAgent: id,
      view: "chat",
      mobileScreen: "sessions",
    });
  },

  openKnowledgeBase: (id) => {
    history.pushState(
      null,
      "",
      routeToPath({ view: "knowledge-base-chat", agent: id }),
    );
    get().resetChatContext();
    set({
      selectedAgent: id,
      view: "knowledge-base-chat",
      mobileScreen: "sessions",
    });
  },

  openAgentSession: (agentId, sessionId) => {
    history.pushState(
      null,
      "",
      routeToPath({ view: "chat", agent: agentId, session: sessionId }),
    );
    get().resetChatContext();
    set({
      selectedAgent: agentId,
      view: "chat",
      mobileScreen: "chat",
      pendingResumeSessionId: sessionId,
    });
  },

  goBack: () => {
    const fromKnowledgeBase = get().view === "knowledge-base-chat";
    history.pushState(
      null,
      "",
      routeToPath({ view: fromKnowledgeBase ? "knowledge-bases" : "home" }),
    );
    get().resetChatContext();
    set({
      selectedAgent: null,
      view: fromKnowledgeBase ? "knowledge-bases" : "home",
    });
  },
});

const RESTART_DISPLAY_TTL_MS = 120_000;

export function transitionRestartingAgents(
  current: Map<string, RestartingEntry>,
  agents: readonly AgentView[],
  now: number = Date.now(),
): Map<string, RestartingEntry> {
  if (current.size === 0) return current;
  const byId = new Map(agents.map((a) => [a.id, a]));
  const next = new Map<string, RestartingEntry>();
  for (const [id, entry] of current) {
    const agent = byId.get(id);
    if (!agent) continue;
    if (now - entry.clickedAt >= RESTART_DISPLAY_TTL_MS) continue;
    if (agent.state === "error") continue;
    if (agent.overBudget) continue;
    if (agent.state !== "running") {
      next.set(id, { ...entry, seenNonRunning: true });
    } else if (!entry.seenNonRunning) {
      next.set(id, entry);
    }
  }
  return next;
}

const PAUSE_DISPLAY_TTL_MS = 30_000;

export function transitionPausingAgents(
  current: Map<string, { clickedAt: number }>,
  agents: readonly AgentView[],
  now: number = Date.now(),
): Map<string, { clickedAt: number }> {
  if (current.size === 0) return current;
  const byId = new Map(agents.map((a) => [a.id, a]));
  const next = new Map<string, { clickedAt: number }>();
  for (const [id, entry] of current) {
    const agent = byId.get(id);
    if (!agent) continue;
    if (now - entry.clickedAt >= PAUSE_DISPLAY_TTL_MS) continue;
    if (agent.state === "error") continue;
    if (agent.state !== "running") continue;
    next.set(id, entry);
  }
  return next.size === current.size ? current : next;
}
