import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";
import type { AgentView } from "../../types.js";
import { routeToPath } from "../platform/lib/routes.js";

/**
 * UI-side state for the agents domain. Server state (agents list,
 * availableChannels) and all the CRUD/lifecycle actions live in
 * modules/agents/api/* as TanStack Query hooks. What's left here is:
 *   - selectedAgent: current chat target (drives URL)
 *   - restartingAgents: optimistic pill-on-restart tracking, updated by
 *     useRestartAgent on click and aged out by useSyncRestartingAgents
 *     against each agents query tick.
 */
export interface AgentsSlice {
  selectedAgent: string | null;
  /** Agent IDs whose pod has been deleted via Restart but hasn't yet cycled
   *  through a non-`running` state back to `running`. Each entry tracks whether
   *  we've observed the intermediate dip so we don't clear on the grace-period
   *  read that still shows `running` before the pod actually terminates, plus
   *  a click timestamp that bounds how long the "Restarting" pill can linger
   *  if the pod fails to recycle cleanly. */
  restartingAgents: Map<string, { seenNonRunning: boolean; clickedAt: number }>;
  setRestartingAgent: (
    id: string,
    entry: { seenNonRunning: boolean; clickedAt: number },
  ) => void;
  clearRestartingAgent: (id: string) => void;
  setRestartingAgents: (
    map: Map<string, { seenNonRunning: boolean; clickedAt: number }>,
  ) => void;
  /** Agent IDs the user just Paused/Stopped: optimistically shown as
   *  "Hibernating" until the poll confirms the pod is down (or a TTL lapses).
   *  Mirrors restartingAgents but only needs the click timestamp — the target
   *  is "no longer running", so there's no intermediate dip to disambiguate. */
  pausingAgents: Map<string, { clickedAt: number }>;
  setPausingAgent: (id: string, entry: { clickedAt: number }) => void;
  clearPausingAgent: (id: string) => void;
  setPausingAgents: (map: Map<string, { clickedAt: number }>) => void;
  /** Reactive circuit breaker: agent IDs whose pod returned 502 ("agent
   *  unreachable") on a per-agent tRPC call. Tripped by the createAgentTrpc
   *  fetch wrapper, cleared once the reachability probe gets a 2xx. Gates pod
   *  calls regardless of who restarted the pod (env edit, controller, schedule). */
  unreachableAgents: ReadonlySet<string>;
  markAgentUnreachable: (id: string) => void;
  clearAgentUnreachable: (id: string) => void;
  selectAgent: (id: string) => void;
  /** Enter a knowledge base's standalone chat page (`/knowledge-bases/:id`).
   *  Same chat surface as selectAgent, but the view keeps KB identity so the
   *  rail highlights Knowledge bases and goBack returns to the KB list. */
  openKnowledgeBase: (id: string) => void;
  openAgentSession: (agentId: string, sessionId: string) => void;
  /** Enter chat and open a fresh web terminal for the agent. */
  openAgentTerminal: (agentId: string) => void;
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
    history.pushState(null, "", routeToPath({ view: "chat", agent: agentId }));
    get().resetChatContext();
    set({
      selectedAgent: agentId,
      view: "chat",
      mobileScreen: "chat",
      pendingResumeSessionId: sessionId,
    });
  },

  openAgentTerminal: (agentId) => {
    history.pushState(null, "", routeToPath({ view: "chat", agent: agentId }));
    // Set the pending flag after the reset (which clears it), mirroring the
    // resume handoff; chat-view consumes it on entry to spawn a terminal.
    get().resetChatContext();
    set({
      selectedAgent: agentId,
      view: "chat",
      mobileScreen: "chat",
      pendingTerminal: true,
    });
  },

  goBack: () => {
    // Leaving a knowledge base's chat returns to its own list, not Sandboxes.
    const fromKnowledgeBase = get().view === "knowledge-base-chat";
    history.pushState(
      null,
      "",
      routeToPath({ view: fromKnowledgeBase ? "knowledge-bases" : "list" }),
    );
    get().resetChatContext();
    set({
      selectedAgent: null,
      view: fromKnowledgeBase ? "knowledge-bases" : "list",
    });
  },
});

/** Upper bound on how long a single restart can keep the pill on "Restarting".
 *  A healthy pod roll for a single-replica StatefulSet takes <30s; anything
 *  past this ceiling means the pod failed to recycle and the user should see
 *  the underlying state so they can act. */
const RESTART_DISPLAY_TTL_MS = 120_000;

/**
 * Advances each restart entry based on the latest observed agent state:
 *   - agent gone → drop (agent was deleted mid-restart).
 *   - clickedAt older than RESTART_DISPLAY_TTL_MS → drop (stuck restart; let
 *     the real state surface).
 *   - state === "error" → drop (pod is observably not starting; user needs to
 *     see the error, not a stale "Restarting" pill).
 *   - overBudget → drop (the budget gate denied this start — that IS the
 *     attempt's outcome; the parked state must surface, not "Starting").
 *   - state !== "running" → mark seenNonRunning (pod has cycled).
 *   - state === "running" && seenNonRunning → drop (restart complete).
 *   - state === "running" && !seenNonRunning → keep (still in grace window
 *     before the pod terminates; the poll that sees it down will flip it).
 * Exported for tests. Accepts `now` for deterministic testing.
 */
export function transitionRestartingAgents(
  current: Map<string, { seenNonRunning: boolean; clickedAt: number }>,
  agents: readonly AgentView[],
  now: number = Date.now(),
): Map<string, { seenNonRunning: boolean; clickedAt: number }> {
  if (current.size === 0) return current;
  const byId = new Map(agents.map((a) => [a.id, a]));
  const next = new Map<
    string,
    { seenNonRunning: boolean; clickedAt: number }
  >();
  for (const [id, entry] of current) {
    const agent = byId.get(id);
    if (!agent) continue;
    if (now - entry.clickedAt >= RESTART_DISPLAY_TTL_MS) continue;
    if (agent.state === "error") continue;
    if (agent.overBudget) continue;
    if (agent.state !== "running") {
      next.set(id, { seenNonRunning: true, clickedAt: entry.clickedAt });
    } else if (!entry.seenNonRunning) {
      next.set(id, entry);
    }
  }
  return next;
}

/** A pause/stop takes the pod down quickly; past this the request likely
 *  didn't land, so drop the optimistic pill and let the real state surface. */
const PAUSE_DISPLAY_TTL_MS = 30_000;

/**
 * Ages out each pause/stop entry against the latest agent state:
 *   - agent gone → drop; clickedAt past the TTL → drop (request didn't land).
 *   - state === "error" → drop (surface the error, not a stale pill).
 *   - state !== "running" → drop: the pod is down, so the real hibernated
 *     state now carries the same "Hibernating" pill the overlay was faking.
 *   - state === "running" → keep: the poll hasn't seen the pod dip yet.
 * Exported for tests. Accepts `now` for deterministic testing.
 */
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
  // `next` is always a subset of `current`, so equal sizes mean identical
  // membership — return the same reference so callers can skip a redundant
  // store update (and re-render) on every poll while a pill is live.
  return next.size === current.size ? current : next;
}
