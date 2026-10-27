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
import { layerAbove } from "@/lib/layer-above";
import { cn } from "@/lib/utils";

import { ResizeHandle } from "../../../components/resize-handle.js";
import {
  readPersistedNumber,
  writePersistedNumber,
} from "../../../lib/persisted-prefs.js";
import { useStore } from "../../../store.js";
import { ApprovalsPanel } from "../../home/components/approvals-panel.js";
import { holdBackEntry } from "../../platform/lib/back-entry.js";
import { CLASSIC_RIGHT_RAIL_W } from "../../platform/lib/sidebar-layout.js";
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
 * the shell shows them itself. The page stays inside the same column while the
 * panel column comes and goes, so opening a panel never remounts it; a shell
 * whose page keeps its panels outside the shell draws no column at all.
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
  rail = true,
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
  rail?: boolean;
  children: ReactNode;
}) {
  const barW = CLASSIC_RIGHT_RAIL_W;
  const openDock = useStore((s) => s.dock);
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
    openDock?.kind === "file" ? openDock.path : null,
    openDock?.kind === "artifact" ? openDock.id : null,
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

  const closeMobilePanel = useCallback(() => {
    setSidePanelTab(null);
    setMobileScreen("chat");
  }, [setSidePanelTab, setMobileScreen]);
  const mobileOverlay = mobilePanelOpen && !desktop;
  useEffect(() => {
    if (!mobileOverlay) return;
    const before = document.activeElement as HTMLElement | null;
    mobileBackRef.current?.focus();
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
  }, [mobileOverlay, closeMobilePanel]);

  // UNIT_BOUNDARY_DESCRIPTION: a page whose panels live outside the shell draws the page column alone and no panel column, so an empty rail never takes room beside it; the column around the page is the same element in both shapes, so its page never remounts.
  if (!rail)
    return (
      <div ref={setColumnsEl} className="flex flex-1 min-h-0 min-w-0">
        <div
          className={cn("relative flex flex-1 flex-col min-w-0", mainClassName)}
        >
          {children}
        </div>
      </div>
    );

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
          "flex bg-chrome relative z-content has-[[data-full-page]]:z-overlay",
          "max-md:fixed max-md:inset-0 max-md:z-overlay",
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
                tooltip={mobileBackLabel}
                onClick={closeMobilePanel}
              >
                <ArrowLeft size={16} />
              </Button>
              <span className="truncate text-sm font-bold text-foreground">
                {mobileTitle}
              </span>
            </div>
            {panel}
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
