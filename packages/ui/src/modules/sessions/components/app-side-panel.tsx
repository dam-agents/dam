import type { ReactNode } from "react";

import { useIsDesktop } from "@/hooks/use-is-desktop";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { ChatArtifactsPanel } from "../../artifacts/components/chat-artifacts-panel.js";
import { DockedArtifactPanel } from "../../artifacts/components/docked-artifact-panel.js";
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

export function AppSidePanelButtons() {
  const { gettingStarted, ...tabs } = useAppSidePanelTabs();
  const openSidePanel = useOpenSidePanel();
  const desktop = useIsDesktop();
  const view = useStore((s) => s.view);
  if (desktop) return null;
  return (
    <SidePanelTabButtons
      tabs={appSidePanelTabs(
        hiddenSidePanelTabs({
          agent: false,
          artifacts: view === "sandbox-home",
          canOpenBrowser: false,
          processesEnabled: false,
          gettingStarted,
        }),
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
 * prompt.
 */
export function AppSidePanelHost({ children }: { children: ReactNode }) {
  const openArtifactId = useStore((s) => s.openArtifactId);
  const artifactDirty = useStore((s) => s.openArtifactDirty);
  const sidePanelTab = useStore((s) => s.sidePanelTab);
  const setSidePanelTab = useStore((s) => s.setSidePanelTab);
  const view = useStore((s) => s.view);
  const agentId = useStore((s) => s.agentId);
  const { gettingStarted, ...tabs } = useAppSidePanelTabs();
  const hidden = hiddenSidePanelTabs({
    agent: false,
    artifacts: view === "sandbox-home",
    canOpenBrowser: false,
    processesEnabled: false,
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
            agentId={agentId}
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
