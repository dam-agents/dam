import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";

export interface PermissionOption {
  optionId: string;
  name: string;
  kind?: "allow_once" | "allow_always" | "reject_once" | "reject_always" | string;
}

export interface PermissionOutcome {
  outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
}

export interface PendingPermission {
  toolCallId: string;
  sessionId: string;
  toolCall: unknown;
  options: PermissionOption[];
  resolve: (outcome: PermissionOutcome) => void;
}

export interface PermissionsSlice {
  // Pending tool-permission prompts from the agent. Replaces client-side
  // auto-approve: the agent blocks until a human resolves the request, so
  // unattended/disconnected sessions accumulate prompts here and the next
  // connected client sees them.
  pendingPermissions: PendingPermission[];
  addPendingPermission: (p: PendingPermission) => void;
  resolvePendingPermission: (toolCallId: string, outcome: PermissionOutcome) => void;
  /** Local-only dismissal: remove the entry from store without resolving. The
   *  agent's JSON-RPC call stays pending server-side and the UI re-shows the
   *  prompt on the next attach. */
  dismissPendingPermission: (toolCallId: string) => void;
  clearPendingPermissions: () => void;
}

export const createPermissionsSlice: StateCreator<PlatformStore, [], [], PermissionsSlice> = (set, get) => ({
  pendingPermissions: [],
  addPendingPermission: (p) =>
    set((s) => {
      // Replace any existing entry for the same toolCallId — this happens on
      // reconnect when the agent-runtime replays pending requests to the new
      // WebSocket, giving us a fresh resolver tied to the live connection.
      const next = s.pendingPermissions.filter((x) => x.toolCallId !== p.toolCallId);
      next.push(p);
      return { pendingPermissions: next };
    }),
  resolvePendingPermission: (toolCallId, outcome) => {
    const entry = get().pendingPermissions.find((p) => p.toolCallId === toolCallId);
    if (!entry) return;
    entry.resolve(outcome);
    set((s) => ({ pendingPermissions: s.pendingPermissions.filter((p) => p.toolCallId !== toolCallId) }));
  },
  dismissPendingPermission: (toolCallId) => {
    set((s) => ({ pendingPermissions: s.pendingPermissions.filter((p) => p.toolCallId !== toolCallId) }));
  },
  clearPendingPermissions: () => set({ pendingPermissions: [] }),
});
