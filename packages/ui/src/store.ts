import { create } from "zustand";

import { type A2uiSlice, createA2uiSlice } from "./modules/a2ui/store.js";
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
  type ChangesSlice,
  createChangesSlice,
} from "./modules/changes/store.js";
import {
  createFeaturesSlice,
  type FeaturesSlice,
} from "./modules/features/store.js";
import { createFilesSlice, type FilesSlice } from "./modules/files/store.js";
import {
  createGettingStartedSlice,
  type GettingStartedSlice,
} from "./modules/getting-started/store.js";
import {
  createInvocationsSlice,
  type InvocationsSlice,
} from "./modules/invocations/store.js";
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
import { removeAllUndelivered } from "./modules/sessions/lib/undelivered-store.js";
import {
  createPermissionsSlice,
  type PermissionsSlice,
} from "./modules/sessions/store/permissions.js";
import {
  createSessionsSlice,
  type SessionsSlice,
} from "./modules/sessions/store/sessions.js";
import {
  createSidePanelSlice,
  type SidePanelSlice,
} from "./modules/sessions/store/side-panel.js";

export type PlatformStore = DialogSlice &
  A2uiSlice &
  ThemeSlice &
  NavigationSlice &
  SidebarSlice &
  AgentsSlice &
  SessionsSlice &
  FilesSlice &
  ArtifactsSlice &
  InvocationsSlice &
  BrowserSlice &
  FeaturesSlice &
  PermissionsSlice &
  ProcessesSlice &
  ChangesSlice &
  SidePanelSlice &
  GettingStartedSlice;

export const useStore = create<PlatformStore>()((...a) => ({
  ...createDialogSlice(...a),
  ...createA2uiSlice(...a),
  ...createThemeSlice(...a),
  ...createNavigationSlice(...a),
  ...createSidebarSlice(...a),
  ...createAgentsSlice(...a),
  ...createSessionsSlice(...a),
  ...createFilesSlice(...a),
  ...createArtifactsSlice(...a),
  ...createInvocationsSlice(...a),
  ...createBrowserSlice(...a),
  ...createFeaturesSlice(...a),
  ...createPermissionsSlice(...a),
  ...createProcessesSlice(...a),
  ...createChangesSlice(...a),
  ...createSidePanelSlice(...a),
  ...createGettingStartedSlice(...a),
}));

let draftSyncStarted = false;

export function startDraftSync(ownerId: string): void {
  if (draftSyncStarted) return;
  draftSyncStarted = true;
  if (claimDraftsFor(ownerId)) {
    removeAllUndelivered();
    useStore.setState({ drafts: {} });
  }
  onForeignDraftChange((key, draft) =>
    useStore.getState().applyForeignDraft(key, draft),
  );
  flushDraftsOnHide();
}
