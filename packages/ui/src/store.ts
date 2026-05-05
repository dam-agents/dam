import { create } from "zustand";
import { createDialogSlice, type DialogSlice } from "./store/dialog.js";
import { createThemeSlice, type ThemeSlice } from "./store/theme.js";
import { createNavigationSlice, type NavigationSlice, pathToState } from "./store/navigation.js";
import { createLoadingSlice, type LoadingSlice } from "./store/loading.js";
import { createToastSlice, type ToastSlice } from "./store/toast.js";
import { createInstancesSlice, type InstancesSlice } from "./modules/instances/store.js";
import { createSessionsSlice, type SessionsSlice } from "./modules/sessions/store/sessions.js";
import { createSessionConfigSlice, type SessionConfigSlice } from "./modules/sessions/store/session-config.js";
import { createFilesSlice, type FilesSlice } from "./modules/files/store.js";
import { createPermissionsSlice, type PermissionsSlice } from "./modules/sessions/store/permissions.js";

export type { DialogState } from "./store/dialog.js";
export type { Toast, ToastKind } from "./store/toast.js";
export type { SessionError } from "./modules/sessions/store/sessions.js";
export type { PermissionOption, PermissionOutcome, PendingPermission } from "./modules/sessions/store/permissions.js";

export type PlatformStore =
  & DialogSlice
  & ThemeSlice
  & NavigationSlice
  & LoadingSlice
  & ToastSlice
  & InstancesSlice
  & SessionsSlice
  & SessionConfigSlice
  & FilesSlice
  & PermissionsSlice;

export const useStore = create<PlatformStore>()((...a) => ({
  ...createDialogSlice(...a),
  ...createThemeSlice(...a),
  ...createNavigationSlice(...a),
  ...createLoadingSlice(...a),
  ...createToastSlice(...a),
  ...createInstancesSlice(...a),
  ...createSessionsSlice(...a),
  ...createSessionConfigSlice(...a),
  ...createFilesSlice(...a),
  ...createPermissionsSlice(...a),
}));

// Reuse the path parser for browser back/forward hydration
export { pathToState };
