import { ArrowLeft } from "@carbon/icons-react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
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
import { useNewLayout } from "../../features/hooks/use-new-layout.js";
import { useUnifiedRightToolbar } from "../../features/hooks/use-unified-right-toolbar.js";
import { GettingStartedPanel } from "../../getting-started/components/getting-started-panel.js";
import { ApprovalsPanel } from "../../home/components/approvals-panel.js";
import { holdBackEntry } from "../../platform/lib/back-entry.js";
import {
  CLASSIC_RIGHT_RAIL_W,
  RIGHT_RAIL_W,
} from "../../platform/lib/sidebar-layout.js";
import {
  maximizableView,
  shownSidePanelWidth,
  sidePanelMinWidth,
  type SidePanelTab,
} from "../lib/side-panel.js";
import { RightToolbarTiles } from "./right-toolbar-tiles.js";
import { SidePanelBar, type SidePanelTabProps } from "./side-panel-bar.js";
import { SidePanelEdgeTab } from "./side-panel-edge-tab.js";

const FILE_PANEL_WIDTH_KEY = "platform-file-w";
const MAIN_MIN_W = 360;
const LAYER_ABOVE_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"]';

const layerAbove = () => document.querySelector(LAYER_ABOVE_SELECTOR) !== null;

const dismissLayerAbove = () =>
  (document.activeElement ?? document).dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );

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
  // UNIT_BOUNDARY_DESCRIPTION: JanUI is the only shell whose left navigation is a rail and whose page has no bar above it; the toolbar alone leaves the shell to the page and changes only the right side.
  const janui = useNewLayout();
  const rightToolbar = useUnifiedRightToolbar();
  // UNIT_BOUNDARY_DESCRIPTION: a tab is the whole of what the panel shows whenever the tiled rail is drawn, whatever shell is around it, so the panel lays over a narrow page and keeps its own top bar with its X instead of a column of sections with a back button.
  const tabbed = janui || rightToolbar;
  const barW = rightToolbar ? RIGHT_RAIL_W : CLASSIC_RIGHT_RAIL_W;
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
  const mobilePanelOpen = tabbed
    ? sidePanelOpen
    : mobileOnPanel || (sidePanelOpen && dockedShown);
  const maximizable = maximizableView(
    activeTab,
    dockedShown,
    openFilePath,
    openArtifactId,
  );
  const maximized = maximizable !== null && sidePanelMaximized === maximizable;
  const sidePanelMinW = sidePanelMinWidth(activeTab);
  const columnsDoNotFit =
    columnsW !== null && columnsW < MAIN_MIN_W + sidePanelMinW + barW;
  const sidePanelFills = maximized || (sidePanelOpen && columnsDoNotFit);
  const sidePanelMaxW = columnsW === null ? null : columnsW - MAIN_MIN_W - barW;
  const sidePanelW =
    rightW === null
      ? null
      : shownSidePanelWidth(rightW, sidePanelMinW, sidePanelMaxW);

  // UNIT_BOUNDARY_DESCRIPTION: which page the panel was opened beside, told apart from what the panel itself shows, so that going somewhere else from the rail ends a panel that had taken the screen.
  const pageKey = useStore((s) =>
    [
      s.view,
      s.selectedAgent ?? s.agentId ?? "",
      s.sessionId ?? "",
      s.settingsTab ?? "",
      s.sandboxSection ?? "",
      s.starterKitCatalog ?? "",
      s.starterKitId ?? "",
    ].join("|"),
  );
  const beside = useRef(pageKey);
  const closeMobilePanel = useCallback(() => {
    setSidePanelTab(null);
    setMobileScreen("chat");
  }, [setSidePanelTab, setMobileScreen]);
  const mobileOverlay = mobilePanelOpen && !desktop;
  useEffect(() => {
    if (beside.current === pageKey) return;
    beside.current = pageKey;
    if (tabbed && mobileOverlay) closeMobilePanel();
  }, [pageKey, tabbed, mobileOverlay, closeMobilePanel]);
  useEffect(() => {
    if (!mobileOverlay) return;
    const before = document.activeElement as HTMLElement | null;
    // UNIT_BOUNDARY_DESCRIPTION: a tabbed panel has no back button over a narrow page, so the keyboard starts on the X that closes it instead.
    (tabbed
      ? filePanelRef.current?.querySelector<HTMLElement>(
          '[data-testid="side-panel-close"]',
        )
      : mobileBackRef.current
    )?.focus();
    // UNIT_BOUNDARY_DESCRIPTION: over the page the panel is the only thing to reach, so Tab stays inside it; the element that opened it gets the keyboard back when it closes.
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.defaultPrevented || layerAbove()) return;
      const root = filePanelRef.current;
      if (!root) return;
      const items = [
        ...root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (!root.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onTab);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (layerAbove()) return;
      closeMobilePanel();
    };
    document.addEventListener("keydown", onKeyDown);
    const releaseBackEntry = holdBackEntry(() => {
      if (layerAbove()) {
        dismissLayerAbove();
        return false;
      }
      closeMobilePanel();
      return true;
    });
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keydown", onTab);
      releaseBackEntry();
      before?.focus();
    };
  }, [mobileOverlay, tabbed, closeMobilePanel]);

  return (
    <div ref={setColumnsEl} className="flex flex-1 min-h-0 min-w-0">
      <div
        className={cn(
          "relative flex flex-1 flex-col min-w-0",
          mobilePanelOpen && "hidden md:flex",
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
          "flex bg-chrome relative z-content",
          tabbed
            ? cn(
                mobilePanelOpen &&
                  cn(
                    "max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-overlay",
                    // UNIT_BOUNDARY_DESCRIPTION: a page with the left rail under it leaves that rail standing beside the panel it lays over, while a page with no rail keeps the whole width; the inset belongs to the open overlay, since a closed panel's rail sits in the page's own row.
                    janui ? "max-md:left-14" : "max-md:left-0",
                  ),
                !janui && !mobilePanelOpen && "max-md:hidden",
              )
            : cn(
                "max-md:fixed max-md:inset-0 max-md:z-overlay",
                !mobilePanelOpen && "max-md:hidden",
              ),
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
            <div
              className={cn(
                "flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3",
                // UNIT_BOUNDARY_DESCRIPTION: a tabbed panel fills the screen beside its rail at a narrow width, so it keeps its own top bar with its X instead of a back button and a title of its own.
                tabbed ? "hidden" : "md:hidden",
              )}
            >
              <Button
                ref={mobileBackRef}
                variant="ghost"
                size="icon-sm"
                aria-label={mobileBackLabel}
                tooltip={mobileBackLabel}
                onClick={closeMobilePanel}
              >
                <ArrowLeft size={16} />
              </Button>
              <span className="truncate text-sm font-bold text-foreground">
                {mobileTitle}
              </span>
            </div>
            <RightToolbarTiles.Provider value={rightToolbar}>
              {panel}
              {activeTab === "getting-started" && (
                <GettingStartedPanel className="flex-1" />
              )}
              {activeTab === "approvals" && (
                <ApprovalsPanel className="flex-1" />
              )}
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
            </RightToolbarTiles.Provider>
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
          tiles={rightToolbar}
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
