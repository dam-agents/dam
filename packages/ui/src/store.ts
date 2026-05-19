import { create } from "zustand";

import { type AgentsSlice, createAgentsSlice } from "./modules/agents/store.js";
import { createFilesSlice, type FilesSlice } from "./modules/files/store.js";
import { pathToState } from "./modules/platform/lib/routes.js";
import {
  createDialogSlice,
  type DialogSlice,
} from "./modules/platform/store/dialog.js";
import {
  createNavigationSlice,
  type NavigationSlice,
} from "./modules/platform/store/navigation.js";
import {
  createThemeSlice,
  type ThemeSlice,
} from "./modules/platform/store/theme.js";
import {
  createToastSlice,
  type ToastSlice,
} from "./modules/platform/store/toast.js";
import {
  createPermissionsSlice,
  type PermissionsSlice,
} from "./modules/sessions/store/permissions.js";
import {
  createSessionConfigSlice,
  type SessionConfigSlice,
} from "./modules/sessions/store/session-config.js";
import {
  createSessionsSlice,
  type SessionsSlice,
} from "./modules/sessions/store/sessions.js";

export type { DialogState } from "./modules/platform/store/dialog.js";
export type { Toast, ToastKind } from "./modules/platform/store/toast.js";
export type {
  PendingPermission,
  PermissionOption,
  PermissionOutcome,
} from "./modules/sessions/store/permissions.js";
export type { SessionError } from "./modules/sessions/store/sessions.js";

export type PlatformStore = DialogSlice &
  ThemeSlice &
  NavigationSlice &
  ToastSlice &
  AgentsSlice &
  SessionsSlice &
  SessionConfigSlice &
  FilesSlice &
  PermissionsSlice;

export const useStore = create<PlatformStore>()((...a) => ({
  ...createDialogSlice(...a),
  ...createThemeSlice(...a),
  ...createNavigationSlice(...a),
  ...createToastSlice(...a),
  ...createAgentsSlice(...a),
  ...createSessionsSlice(...a),
  ...createSessionConfigSlice(...a),
  ...createFilesSlice(...a),
  ...createPermissionsSlice(...a),
}));

// Reuse the path parser for browser back/forward hydration
export { pathToState };
