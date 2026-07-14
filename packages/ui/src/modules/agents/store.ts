import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";
import type { AgentView } from "../../types.js";
import { viewToPath } from "../platform/lib/routes.js";

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
  /** Reactive circuit breaker: agent IDs whose pod returned 502 ("agent
   *  unreachable") on a per-agent tRPC call. Tripped by the createAgentTrpc
   *  fetch wrapper, cleared once the reachability probe gets a 2xx. Gates pod
   *  calls regardless of who restarted the pod (env edit, controller, schedule). */
  unreachableAgents: ReadonlySet<string>;
  markAgentUnreachable: (id: string) => void;
  clearAgentUnreachable: (id: string) => void;
  selectAgent: (id: string) => void;
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
    history.pushState(null, "", viewToPath("chat", id));
    get().resetChatContext();
    set({
      selectedAgent: id,
      view: "chat",
      mobileScreen: "sessions",
      showMobilePanel: false,
    });
  },

  openAgentSession: (agentId, sessionId) => {
    history.pushState(null, "", viewToPath("chat", agentId));
    get().resetChatContext();
    set({
      selectedAgent: agentId,
      view: "chat",
      mobileScreen: "chat",
      showMobilePanel: false,
      pendingResumeSessionId: sessionId,
    });
  },

  openAgentTerminal: (agentId) => {
    history.pushState(null, "", viewToPath("chat", agentId));
    // Set the pending flag after the reset (which clears it), mirroring the
    // resume handoff; chat-view consumes it on entry to spawn a terminal.
    get().resetChatContext();
    set({
      selectedAgent: agentId,
      view: "chat",
      mobileScreen: "chat",
      showMobilePanel: false,
      pendingTerminal: true,
    });
  },

  goBack: () => {
    history.pushState(null, "", "/");
    get().resetChatContext();
    set({ selectedAgent: null, view: "list", showMobilePanel: false });
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
    if (agent.state !== "running") {
      next.set(id, { seenNonRunning: true, clickedAt: entry.clickedAt });
    } else if (!entry.seenNonRunning) {
      next.set(id, entry);
    }
  }
  return next;
}
