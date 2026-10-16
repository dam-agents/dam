import type { ReactNode } from "react";

import { useIsDesktop } from "@/hooks/use-is-desktop";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { GettingStartedPanel } from "../../getting-started/components/getting-started-panel.js";
import { ApprovalsPanel } from "../../home/components/approvals-panel.js";
import { useAppSidePanelTabs } from "../hooks/use-app-side-panel-tabs.js";
import { useOpenSidePanel } from "../hooks/use-open-side-panel.js";
import { useSidePanelLayout } from "../hooks/use-side-panel-layout.js";
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
  SidePanelBar,
  SidePanelTabButtons,
} from "./side-panel-bar.js";
import { SidePanelFrame } from "./side-panel-frame.js";

const PAGE_MIN_W = 320;

export function AppSidePanel({ tab }: { tab: SidePanelTab | null }) {
  if (tab === "getting-started")
    return <GettingStartedPanel className="flex-1" />;
  if (tab === "approvals") return <ApprovalsPanel className="flex-1" />;
  return null;
}

export function AppSidePanelButtons() {
  const { gettingStarted, ...tabs } = useAppSidePanelTabs();
  const openSidePanel = useOpenSidePanel();
  const desktop = useIsDesktop();
  if (desktop) return null;
  return (
    <SidePanelTabButtons
      tabs={appSidePanelTabs(
        hiddenSidePanelTabs({
          agent: false,
          canOpenBrowser: false,
          processesEnabled: false,
          gettingStarted,
        }),
      )}
      active={null}
      onSelect={openSidePanel}
      tooltipSide="bottom"
      {...tabs}
    />
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The icon bar and side panel of every page but an
 * Agent's chat, which hosts its own with the Agent's tabs added. Here only the
 * panels that belong to no Agent are offered: Get started and Approvals.
 */
export function AppSidePanelHost({ children }: { children: ReactNode }) {
  const sidePanelTab = useStore((s) => s.sidePanelTab);
  const setSidePanelTab = useStore((s) => s.setSidePanelTab);
  const mobileScreen = useStore((s) => s.mobileScreen);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const { gettingStarted, ...tabs } = useAppSidePanelTabs();
  const hidden = hiddenSidePanelTabs({
    agent: false,
    canOpenBrowser: false,
    processesEnabled: false,
    gettingStarted,
  });
  const activeTab = visibleSidePanelTab(sidePanelTab, NOTHING_DOCKED, hidden);
  const layout = useSidePanelLayout(activeTab, PAGE_MIN_W);
  const open = activeTab !== null;
  const fills = open && layout.doesNotFit;

  return (
    <div ref={layout.setRowEl} className="flex min-h-0 min-w-0 flex-1">
      <div className={cn("flex min-w-0 flex-1", fills && "md:hidden")}>
        {children}
      </div>
      <SidePanelFrame
        layout={layout}
        open={open}
        fills={fills}
        mobileOpen={open && mobileScreen === "files"}
        mobileTitle={SIDE_PANEL_TABS.find((t) => t.tab === activeTab)?.label}
        onMobileBack={() => {
          setSidePanelTab(null);
          setMobileScreen("chat");
        }}
        bar={
          <SidePanelBar
            active={activeTab}
            hidden={hidden}
            onSelect={(tab) =>
              setSidePanelTab(
                selectSidePanelTab(tab, activeTab, NOTHING_DOCKED).kind ===
                  "collapse"
                  ? null
                  : tab,
              )
            }
            {...tabs}
          />
        }
      >
        <AppSidePanel tab={activeTab} />
      </SidePanelFrame>
    </div>
  );
}
