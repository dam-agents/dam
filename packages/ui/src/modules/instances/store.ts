import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";
import type { InstanceView } from "../../types.js";
import { viewToPath } from "../platform/lib/routes.js";

/**
 * UI-side state for the instances domain. Server state (instances list,
 * availableChannels) and all the CRUD/lifecycle actions live in
 * modules/instances/api/* as TanStack Query hooks. What's left here is:
 *   - selectedInstance: current chat target (drives URL)
 *   - restartingInstances: optimistic pill-on-restart tracking, updated by
 *     useRestartInstance on click and aged out by useSyncRestartingInstances
 *     against each instances query tick.
 */
export interface InstancesSlice {
  selectedInstance: string | null;
  /** Instance IDs whose pod has been deleted via Restart but hasn't yet cycled
   *  through a non-`running` state back to `running`. Each entry tracks whether
   *  we've observed the intermediate dip so we don't clear on the grace-period
   *  read that still shows `running` before the pod actually terminates, plus
   *  a click timestamp that bounds how long the "Restarting" pill can linger
   *  if the pod fails to recycle cleanly. */
  restartingInstances: Map<
    string,
    { seenNonRunning: boolean; clickedAt: number }
  >;
  setRestartingInstance: (
    id: string,
    entry: { seenNonRunning: boolean; clickedAt: number },
  ) => void;
  clearRestartingInstance: (id: string) => void;
  setRestartingInstances: (
    map: Map<string, { seenNonRunning: boolean; clickedAt: number }>,
  ) => void;
  selectInstance: (id: string) => void;
  goBack: () => void;
}

export const createInstancesSlice: StateCreator<
  PlatformStore,
  [],
  [],
  InstancesSlice
> = (set, get) => ({
  selectedInstance: null,
  restartingInstances: new Map(),

  setRestartingInstance: (id, entry) =>
    set((s) => {
      const next = new Map(s.restartingInstances);
      next.set(id, entry);
      return { restartingInstances: next };
    }),
  clearRestartingInstance: (id) =>
    set((s) => {
      const next = new Map(s.restartingInstances);
      next.delete(id);
      return { restartingInstances: next };
    }),
  setRestartingInstances: (map) => set({ restartingInstances: map }),

  selectInstance: (id) => {
    history.pushState(null, "", viewToPath("chat", id));
    get().resetChatContext();
    set({
      selectedInstance: id,
      view: "chat",
      mobileScreen: "sessions",
      showMobilePanel: false,
    });
  },

  goBack: () => {
    history.pushState(null, "", "/");
    get().resetChatContext();
    set({ selectedInstance: null, view: "list", showMobilePanel: false });
  },
});

/** Upper bound on how long a single restart can keep the pill on "Restarting".
 *  A healthy pod roll for a single-replica StatefulSet takes <30s; anything
 *  past this ceiling means the pod failed to recycle and the user should see
 *  the underlying state so they can act. */
const RESTART_DISPLAY_TTL_MS = 120_000;

/**
 * Advances each restart entry based on the latest observed instance state:
 *   - instance gone → drop (instance was deleted mid-restart).
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
export function transitionRestartingInstances(
  current: Map<string, { seenNonRunning: boolean; clickedAt: number }>,
  instances: InstanceView[],
  now: number = Date.now(),
): Map<string, { seenNonRunning: boolean; clickedAt: number }> {
  if (current.size === 0) return current;
  const byId = new Map(instances.map((i) => [i.id, i]));
  const next = new Map<
    string,
    { seenNonRunning: boolean; clickedAt: number }
  >();
  for (const [id, entry] of current) {
    const inst = byId.get(id);
    if (!inst) continue;
    if (now - entry.clickedAt >= RESTART_DISPLAY_TTL_MS) continue;
    if (inst.state === "error") continue;
    if (inst.state !== "running") {
      next.set(id, { seenNonRunning: true, clickedAt: entry.clickedAt });
    } else if (!entry.seenNonRunning) {
      next.set(id, entry);
    }
  }
  return next;
}
