import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";

export interface PermissionOption {
  optionId: string;
  name: string;
  kind?:
    "allow_once" | "allow_always" | "reject_once" | "reject_always" | string;
}

export interface PermissionOutcome {
  outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
}

export interface PendingPermission {
  toolCallId: string;
  sessionId: string;
  toolCall: unknown;
  options: PermissionOption[];
  isOpen: () => boolean;
  resolve: (outcome: PermissionOutcome) => boolean;
}

export interface PermissionsSlice {
  pendingPermissions: PendingPermission[];
  addPendingPermission: (p: PendingPermission) => void;
  resolvePendingPermission: (
    toolCallId: string,
    outcome: PermissionOutcome,
  ) => boolean;
  dismissPendingPermission: (toolCallId: string) => void;
  dropPermissionsFromClosedChannels: () => void;
}

export const createPermissionsSlice: StateCreator<
  PlatformStore,
  [],
  [],
  PermissionsSlice
> = (set, get) => ({
  pendingPermissions: [],
  addPendingPermission: (p) =>
    set((s) => {
      const next = s.pendingPermissions.filter(
        (x) => x.toolCallId !== p.toolCallId,
      );
      next.push(p);
      return { pendingPermissions: next };
    }),
  resolvePendingPermission: (toolCallId, outcome) => {
    const entry = get().pendingPermissions.find(
      (p) => p.toolCallId === toolCallId,
    );
    if (!entry || !entry.resolve(outcome)) return false;
    set((s) => ({
      pendingPermissions: s.pendingPermissions.filter(
        (p) => p.toolCallId !== toolCallId,
      ),
    }));
    return true;
  },
  dismissPendingPermission: (toolCallId) => {
    set((s) => ({
      pendingPermissions: s.pendingPermissions.filter(
        (p) => p.toolCallId !== toolCallId,
      ),
    }));
  },
  dropPermissionsFromClosedChannels: () =>
    set((s) => {
      const open = s.pendingPermissions.filter((p) => p.isOpen());
      if (open.length === s.pendingPermissions.length) return {};
      return { pendingPermissions: open };
    }),
});
