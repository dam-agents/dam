import { ArrowLeft } from "@carbon/icons-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { cn } from "@/lib/utils";

import { ResizeHandle } from "../../../components/resize-handle.js";
import {
  readPersistedNumber,
  writePersistedNumber,
} from "../../../lib/persisted-prefs.js";
import { useStore } from "../../../store.js";
import { GettingStartedPanel } from "../../getting-started/components/getting-started-panel.js";
import { ApprovalsPanel } from "../../home/components/approvals-panel.js";
import {
  maximizableView,
  shownSidePanelWidth,
  sidePanelMinWidth,
  type SidePanelTab,
} from "../lib/side-panel.js";
import { SidePanelBar, type SidePanelTabProps } from "./side-panel-bar.js";
import { SidePanelEdgeTab } from "./side-panel-edge-tab.js";

const FILE_PANEL_WIDTH_KEY = "platform-file-w";
const MAIN_MIN_W = 360;
const SIDE_PANEL_BAR_W = 49;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The side panel beside a page's main column, with
 * its icon rail, resize handle, saved width, maximize edge tab and full-screen
 * phone view. The chat view and every other page share it, so the panel looks
 * and sizes the same wherever it opens; each caller decides which tabs exist
 * and what its own tabs show. Get started and Approvals belong to no page, so
 * the shell shows them itself.
 */
export function SidePanelShell({
  activeTab,
  hiddenTabs,
  onSelectTab,
  badges,
  icons,
  dockedShown,
  dockedKept,
  panel,
  dock,
  mobileTitle,
  mobileBackLabel,
  mainClassName,
  children,
}: {
  activeTab: SidePanelTab | null;
  hiddenTabs: ReadonlySet<SidePanelTab>;
  onSelectTab: (tab: SidePanelTab) => void;
  badges?: SidePanelTabProps["badges"];
  icons?: SidePanelTabProps["icons"];
  dockedShown: boolean;
  dockedKept: boolean;
  panel: ReactNode;
  dock: ReactNode;
  mobileTitle: ReactNode;
  mobileBackLabel: string;
  mainClassName?: string;
  children: ReactNode;
}) {
  const openFilePath = useStore((s) => s.openFilePath);
  const openArtifactId = useStore((s) => s.openArtifactId);
  const setSidePanelTab = useStore((s) => s.setSidePanelTab);
  const sidePanelMaximized = useStore((s) => s.sidePanelMaximized);
  const setSidePanelMaximized = useStore((s) => s.setSidePanelMaximized);
  const mobileScreen = useStore((s) => s.mobileScreen);
  const setMobileScreen = useStore((s) => s.setMobileScreen);

  const [rightW, setRightW] = useState<number | null>(() =>
    readPersistedNumber(FILE_PANEL_WIDTH_KEY, null),
  );
  const rightWRef = useRef(rightW);
  const [columnsEl, setColumnsEl] = useState<HTMLDivElement | null>(null);
  const [columnsW, setColumnsW] = useState<number | null>(null);
  useEffect(() => {
    if (!columnsEl) return;
    const ro = new ResizeObserver(([entry]) =>
      setColumnsW(entry.contentRect.width),
    );
    ro.observe(columnsEl);
    return () => ro.disconnect();
  }, [columnsEl]);
  const filePanelRef = useRef<HTMLDivElement>(null);
  const mobileBackRef = useRef<HTMLButtonElement>(null);
  const desktop = useIsDesktop();

  const sidePanelOpen = activeTab !== null;
  const mobileOnPanel = sidePanelOpen && mobileScreen === "files";
  const mobilePanelOpen = mobileOnPanel || (sidePanelOpen && dockedShown);
  const maximizable = maximizableView(
    activeTab,
    dockedShown,
    openFilePath,
    openArtifactId,
  );
  const maximized = maximizable !== null && sidePanelMaximized === maximizable;
  const sidePanelMinW = sidePanelMinWidth(activeTab);
  const columnsDoNotFit =
    columnsW !== null &&
    columnsW < MAIN_MIN_W + sidePanelMinW + SIDE_PANEL_BAR_W;
  const sidePanelFills = maximized || (sidePanelOpen && columnsDoNotFit);
  const sidePanelMaxW =
    columnsW === null ? null : columnsW - MAIN_MIN_W - SIDE_PANEL_BAR_W;
  const sidePanelW =
    rightW === null
      ? null
      : shownSidePanelWidth(rightW, sidePanelMinW, sidePanelMaxW);

  const closeMobilePanel = () => {
    setSidePanelTab(null);
    setMobileScreen("chat");
  };
  const mobileOverlay = mobilePanelOpen && !desktop;
  useEffect(() => {
    if (!mobileOverlay) return;
    mobileBackRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"]',
        )
      )
        return;
      setSidePanelTab(null);
      setMobileScreen("chat");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOverlay, setSidePanelTab, setMobileScreen]);

  return (
    <div ref={setColumnsEl} className="flex flex-1 min-h-0 min-w-0">
      <div
        className={cn(
          "relative flex flex-1 flex-col min-w-0",
          mobileOnPanel && "hidden md:flex",
          sidePanelFills && "md:!hidden",
          mainClassName,
        )}
      >
        {children}
      </div>

      {sidePanelOpen && !sidePanelFills && (
        <div className="hidden md:flex">
          <ResizeHandle
            side="right"
            label="Resize side panel"
            value={sidePanelW ?? undefined}
            onResize={(d) => {
              const max = sidePanelMaxW ?? window.innerWidth - 500;
              const base = shownSidePanelWidth(
                rightWRef.current ?? filePanelRef.current?.offsetWidth ?? 0,
                sidePanelMinW,
                max,
              );
              const v = Math.max(sidePanelMinW, Math.min(max, base + d));
              rightWRef.current = v;
              writePersistedNumber(FILE_PANEL_WIDTH_KEY, v);
              setRightW(v);
            }}
          />
        </div>
      )}
      <div
        data-testid="side-panel"
        className={cn(
          "flex bg-background relative z-content max-md:fixed max-md:inset-0 max-md:z-overlay",
          !mobilePanelOpen && "max-md:hidden",
          sidePanelFills
            ? "md:flex-1 md:min-w-0"
            : sidePanelOpen && sidePanelW === null
              ? "md:flex-1 md:basis-0 md:min-w-0"
              : "md:shrink-0",
        )}
      >
        {(sidePanelOpen || dockedKept) && (
          <div
            ref={filePanelRef}
            style={
              {
                "--file-min-w": `${sidePanelMinW}px`,
                ...(sidePanelW !== null && { "--file-w": `${sidePanelW}px` }),
              } as CSSProperties
            }
            className={cn(
              "flex flex-col min-w-0 overflow-hidden max-md:flex-1",
              !sidePanelFills && "md:min-w-[var(--file-min-w)]",
              !sidePanelOpen && "hidden",
              sidePanelFills || sidePanelW === null
                ? "md:flex-1"
                : "md:shrink-0 md:w-[var(--file-w)]",
              "md:border-l md:border-border",
            )}
          >
            <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3 md:hidden">
              <Button
                ref={mobileBackRef}
                variant="ghost"
                size="icon-sm"
                aria-label={mobileBackLabel}
                onClick={closeMobilePanel}
              >
                <ArrowLeft size={16} />
              </Button>
              <span className="truncate text-sm font-bold text-foreground">
                {mobileTitle}
              </span>
            </div>
            {panel}
            {activeTab === "getting-started" && (
              <GettingStartedPanel className="flex-1" />
            )}
            {activeTab === "approvals" && <ApprovalsPanel className="flex-1" />}
            {dockedKept && (
              <div
                className={cn(
                  "flex flex-1 min-h-0 flex-col",
                  !dockedShown && "hidden",
                )}
              >
                {dock}
              </div>
            )}
          </div>
        )}
        {sidePanelOpen && maximizable && (maximized || !columnsDoNotFit) && (
          <SidePanelEdgeTab
            maximized={maximized}
            onToggle={() =>
              setSidePanelMaximized(maximized ? null : maximizable)
            }
          />
        )}
        <SidePanelBar
          active={activeTab}
          hidden={hiddenTabs}
          onSelect={onSelectTab}
          badges={badges}
          icons={icons}
        />
      </div>
    </div>
  );
}
