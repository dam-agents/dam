import { create } from "zustand";

import { type AgentsSlice, createAgentsSlice } from "./modules/agents/store.js";
import {
  type ArtifactsSlice,
  createArtifactsSlice,
} from "./modules/artifacts/store.js";
import {
  createExperimentsSlice,
  type ExperimentsSlice,
} from "./modules/experiments/store.js";
import { createFilesSlice, type FilesSlice } from "./modules/files/store.js";
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
  createPermissionsSlice,
  type PermissionsSlice,
} from "./modules/sessions/store/permissions.js";
import {
  createSessionsSlice,
  type SessionsSlice,
} from "./modules/sessions/store/sessions.js";

export type { DialogState } from "./modules/platform/store/dialog.js";
export type {
  PendingPermission,
  PermissionOption,
  PermissionOutcome,
} from "./modules/sessions/store/permissions.js";
export type { SessionError } from "./modules/sessions/store/sessions.js";

export type PlatformStore = DialogSlice &
  ThemeSlice &
  NavigationSlice &
  AgentsSlice &
  SessionsSlice &
  ExperimentsSlice &
  FilesSlice &
  ArtifactsSlice &
  PermissionsSlice;

export const useStore = create<PlatformStore>()((...a) => ({
  ...createDialogSlice(...a),
  ...createThemeSlice(...a),
  ...createNavigationSlice(...a),
  ...createAgentsSlice(...a),
  ...createSessionsSlice(...a),
  ...createExperimentsSlice(...a),
  ...createFilesSlice(...a),
  ...createArtifactsSlice(...a),
  ...createPermissionsSlice(...a),
}));
