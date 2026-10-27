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
  type SidePanelTab,
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
  onDesktop = false,
}: {
  withArtifacts?: boolean;
  onDesktop?: boolean;
}) {
  const tabs = useAppSidePanelTabs();
  const openSidePanel = useOpenSidePanel();
  const desktop = useIsDesktop();
  const view = useStore((s) => s.view);
  if (desktop && !onDesktop) return null;
  return (
    <SidePanelTabButtons
      tabs={appSidePanelTabs(
        hiddenSidePanelTabs({
          agent: false,
          artifacts: view === "sandbox-home",
          canOpenBrowser: false,
          changes: false,
          processesEnabled: false,
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
 * chat: on an Agent's configuration page it holds Artifacts, scoped to that
 * Agent with a switch to the whole library. Other pages leave Artifacts to the
 * Artifacts page, whose opened artifact docks here without the interactive
 * bridge, because no chat is open to receive a prompt.
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
  const tabs = useAppSidePanelTabs();
  // UNIT_BOUNDARY_DESCRIPTION: Approvals is a drawer over the page, not a side-panel tab, so the shell's bar holds only the tabs it opens; the drawer reads the same store tab.
  const shellHidden = new Set<SidePanelTab>([
    ...hiddenSidePanelTabs({
      agent: false,
      artifacts: view === "sandbox-home",
      canOpenBrowser: false,
      changes: false,
      processesEnabled: false,
    }),
    "approvals",
  ]);
  const activeTab =
    view === "artifacts" &&
    openArtifactId !== null &&
    sidePanelTab === "artifacts"
      ? "artifacts"
      : visibleSidePanelTab(sidePanelTab, NOTHING_DOCKED, shellHidden);
  const dockedShown = openArtifactId !== null && activeTab === "artifacts";
  const dockedKept = openArtifactId !== null && (dockedShown || artifactDirty);
  // UNIT_BOUNDARY_DESCRIPTION: the page stays in the shell's column whatever its panel does, so opening a panel never remounts the page; with nothing to show, the shell draws no column at all and the page takes the whole window.
  const rail = activeTab !== null || openArtifactId !== null;

  return (
    <SidePanelShell
      mainClassName="z-content"
      rail={rail}
      activeTab={activeTab}
      hiddenTabs={shellHidden}
      onSelectTab={(tab) =>
        setSidePanelTab(
          selectSidePanelTab(tab, activeTab, NOTHING_DOCKED).kind === "collapse"
            ? null
            : tab,
        )
      }
      {...tabs}
      dockedShown={dockedShown}
      dockedKept={dockedKept}
      mobileTitle={SIDE_PANEL_TABS.find((t) => t.tab === activeTab)?.label}
      mobileBackLabel="Close side panel"
      panel={
        activeTab === "artifacts" &&
        !shellHidden.has("artifacts") && (
          <ChatArtifactsPanel
            agentId={view !== "sandbox-home" ? null : agentId}
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
