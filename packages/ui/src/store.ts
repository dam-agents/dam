import { create } from "zustand";

import { type AgentsSlice, createAgentsSlice } from "./modules/agents/store.js";
import {
  type ArtifactsSlice,
  createArtifactsSlice,
} from "./modules/artifacts/store.js";
import {
  type BrowserSlice,
  createBrowserSlice,
} from "./modules/browser/store.js";
import {
  createExperimentsSlice,
  type ExperimentsSlice,
} from "./modules/experiments/store.js";
import { createFilesSlice, type FilesSlice } from "./modules/files/store.js";
import {
  createDismissalsSlice,
  type DismissalsSlice,
} from "./modules/home/store.js";
import { createPacksSlice, type PacksSlice } from "./modules/packs/store.js";
import {
  createDialogSlice,
  type DialogSlice,
} from "./modules/platform/store/dialog.js";
import {
  createNavigationSlice,
  type NavigationSlice,
} from "./modules/platform/store/navigation.js";
import {
  createSidebarSlice,
  type SidebarSlice,
} from "./modules/platform/store/sidebar.js";
import {
  createSidebarAgentsSlice,
  type SidebarAgentsSlice,
} from "./modules/platform/store/sidebar-agents.js";
import {
  createThemeSlice,
  type ThemeSlice,
} from "./modules/platform/store/theme.js";
import {
  createProcessesSlice,
  type ProcessesSlice,
} from "./modules/processes/store.js";
import {
  claimDraftsFor,
  flushDraftsOnHide,
  onForeignDraftChange,
} from "./modules/sessions/lib/draft-snapshot.js";
import {
  type ChangesPanelSlice,
  createChangesPanelSlice,
} from "./modules/sessions/store/changes-panel.js";
import {
  createEnvironmentPanelSlice,
  type EnvironmentPanelSlice,
} from "./modules/sessions/store/environment-panel.js";
import {
  createPermissionsSlice,
  type PermissionsSlice,
} from "./modules/sessions/store/permissions.js";
import {
  createSessionsSlice,
  type SessionsSlice,
} from "./modules/sessions/store/sessions.js";
import {
  createWorkProcessPanelSlice,
  type WorkProcessPanelSlice,
} from "./modules/sessions/store/work-process-panel.js";

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
  SidebarSlice &
  SidebarAgentsSlice &
  AgentsSlice &
  SessionsSlice &
  ExperimentsSlice &
  FilesSlice &
  ArtifactsSlice &
  BrowserSlice &
  PermissionsSlice &
  ProcessesSlice &
  PacksSlice &
  DismissalsSlice &
  ChangesPanelSlice &
  WorkProcessPanelSlice &
  EnvironmentPanelSlice & {
    openDelegation: unknown | null;
  };

export const useStore = create<PlatformStore>()((...a) => ({
  ...createDialogSlice(...a),
  ...createThemeSlice(...a),
  ...createNavigationSlice(...a),
  ...createSidebarSlice(...a),
  ...createSidebarAgentsSlice(...a),
  ...createAgentsSlice(...a),
  ...createSessionsSlice(...a),
  ...createExperimentsSlice(...a),
  ...createFilesSlice(...a),
  ...createArtifactsSlice(...a),
  ...createBrowserSlice(...a),
  ...createPermissionsSlice(...a),
  ...createProcessesSlice(...a),
  ...createPacksSlice(...a),
  ...createDismissalsSlice(...a),
  ...createChangesPanelSlice(...a),
  ...createWorkProcessPanelSlice(...a),
  ...createEnvironmentPanelSlice(...a),
  openDelegation: null,
}));

let draftSyncStarted = false;

export function startDraftSync(ownerId: string): void {
  if (draftSyncStarted) return;
  draftSyncStarted = true;
  if (claimDraftsFor(ownerId)) useStore.setState({ drafts: {} });
  onForeignDraftChange((key, draft) =>
    useStore.getState().applyForeignDraft(key, draft),
  );
  flushDraftsOnHide();
}
