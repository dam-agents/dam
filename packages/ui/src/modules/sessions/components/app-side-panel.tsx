import type { ReactNode } from "react";

import { useIsDesktop } from "@/hooks/use-is-desktop";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { ChatArtifactsPanel } from "../../artifacts/components/chat-artifacts-panel.js";
import { DockedArtifactPanel } from "../../artifacts/components/docked-artifact-panel.js";
import { useNewLayout } from "../../features/hooks/use-new-layout.js";
import { useUnifiedRightToolbar } from "../../features/hooks/use-unified-right-toolbar.js";
import { useAppSidePanelTabs } from "../hooks/use-app-side-panel-tabs.js";
import { useOpenSidePanel } from "../hooks/use-open-side-panel.js";
import {
  hiddenSidePanelTabs,
  NOTHING_DOCKED,
  selectSidePanelTab,
  visibleSidePanelTab,
} from "../lib/side-panel.js";
import {
  appSidePanelTabs,
  SIDE_PANEL_TABS,
  SidePanelTabButtons,
} from "./side-panel-bar.js";
import { SidePanelShell } from "./side-panel-shell.js";

export function AppSidePanelButtons({
  withArtifacts = false,
}: {
  withArtifacts?: boolean;
}) {
  const { gettingStarted, ...tabs } = useAppSidePanelTabs();
  const openSidePanel = useOpenSidePanel();
  const desktop = useIsDesktop();
  const view = useStore((s) => s.view);
  const newLayout = useNewLayout();
  const rightToolbar = useUnifiedRightToolbar();
  if (desktop) return null;
  return (
    <SidePanelTabButtons
      tabs={appSidePanelTabs(
        hiddenSidePanelTabs({
          agent: false,
          artifacts: newLayout || rightToolbar || view === "sandbox-home",
          canOpenBrowser: false,
          changes: false,
          processesEnabled: false,
          environments: false,
          configuration: false,
          gettingStarted,
        }),
        withArtifacts,
      )}
      active={null}
      onSelect={openSidePanel}
      placement="top-bar"
      {...tabs}
    />
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The side panel on every page outside an Agent's
 * chat: Get started and Approvals, and on an Agent's configuration page also
 * Artifacts, scoped to that Agent with a switch to the whole library. Other
 * pages leave Artifacts to the Artifacts page, whose opened artifact docks
 * here without the interactive bridge, because no chat is open to receive a
 * prompt. With JanUI or the Unified right toolbar experiment on, every
 * page offers Artifacts, listing the whole library.
 */
export function AppSidePanelHost({ children }: { children: ReactNode }) {
  const openArtifactId = useStore((s) =>
    s.dock?.kind === "artifact" ? s.dock.id : null,
  );
  const artifactDirty = useStore((s) => s.openArtifactDirty);
  const sidePanelTab = useStore((s) => s.sidePanelTab);
  const setSidePanelTab = useStore((s) => s.setSidePanelTab);
  const view = useStore((s) => s.view);
  const agentId = useStore((s) => s.agentId);
  const newLayout = useNewLayout();
  const rightToolbar = useUnifiedRightToolbar();
  const { gettingStarted, ...tabs } = useAppSidePanelTabs();
  const hidden = hiddenSidePanelTabs({
    agent: false,
    artifacts: newLayout || rightToolbar || view === "sandbox-home",
    canOpenBrowser: false,
    changes: false,
    processesEnabled: false,
    environments: false,
    configuration: false,
    gettingStarted,
  });
  const activeTab =
    view === "artifacts" &&
    openArtifactId !== null &&
    sidePanelTab === "artifacts"
      ? "artifacts"
      : visibleSidePanelTab(sidePanelTab, NOTHING_DOCKED, hidden);
  const dockedShown = openArtifactId !== null && activeTab === "artifacts";

  return (
    <SidePanelShell
      mainClassName="z-content"
      activeTab={activeTab}
      hiddenTabs={hidden}
      onSelectTab={(tab) =>
        setSidePanelTab(
          selectSidePanelTab(tab, activeTab, NOTHING_DOCKED).kind === "collapse"
            ? null
            : tab,
        )
      }
      {...tabs}
      dockedShown={dockedShown}
      dockedKept={openArtifactId !== null && (dockedShown || artifactDirty)}
      mobileTitle={SIDE_PANEL_TABS.find((t) => t.tab === activeTab)?.label}
      mobileBackLabel="Close side panel"
      panel={
        activeTab === "artifacts" &&
        !hidden.has("artifacts") && (
          <ChatArtifactsPanel
            agentId={newLayout || view !== "sandbox-home" ? null : agentId}
            open
            className={cn("flex-1", dockedShown && "hidden")}
          />
        )
      }
      dock={
        openArtifactId && (
          <DockedArtifactPanel key={openArtifactId} agentId={null} />
        )
      }
    >
      {children}
    </SidePanelShell>
  );
}
